/*
 * mx4300-cpu-oc-stress - stability tester for CPU overclocking.
 *
 *   mx4300-cpu-oc-stress mem   MB SECONDS           memory pattern test
 *   mx4300-cpu-oc-stress cpu   THREADS SECONDS      checked computation
 *   mx4300-cpu-oc-stress all   MB THREADS SECONDS   both at once
 *   mx4300-cpu-oc-stress udp   IP PORT SECONDS [LEN] UDP flood (load)
 *
 * Every error is printed at once ("ERROR ...") and counted; a summary
 * ("STATUS ...") every 10 s and "DONE ..." at the end. Exit code 0 = no
 * errors, 2 = errors seen.
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

static volatile int stop;
static volatile uint64_t mem_errors, cpu_errors, mem_passes, cpu_rounds;
static time_t t_end;

static double now(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec + ts.tv_nsec / 1e9;
}

static void on_signal(int s) { (void)s; stop = 1; }

static int expired(void) { return stop || time(NULL) >= t_end; }

/* ---- memory ---- */

static uint64_t pat(int kind, size_t i, uint64_t seed)
{
	switch (kind) {
	case 0: return 0;
	case 1: return ~0ULL;
	case 2: return 0x5555555555555555ULL;
	case 3: return 0xaaaaaaaaaaaaaaaaULL;
	case 4: return (uint64_t)i * 0x9e3779b97f4a7c15ULL;	/* address-derived */
	default: {						/* pseudo-random */
		uint64_t x = i ^ seed;
		x ^= x >> 33; x *= 0xff51afd7ed558ccdULL;
		x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53ULL;
		return x ^ (x >> 33);
	}
	}
}

static void *mem_thread(void *arg)
{
	size_t bytes = (size_t)(uintptr_t)arg, n = bytes / 8, i;
	volatile uint64_t *buf = mmap(NULL, bytes, PROT_READ | PROT_WRITE,
				      MAP_PRIVATE | MAP_ANONYMOUS | MAP_POPULATE, -1, 0);
	uint64_t seed = 0x1234;

	if (buf == MAP_FAILED) { perror("mmap"); exit(1); }
	if (mlock((void *)buf, bytes)) perror("mlock (continuing unlocked)");

	while (!expired()) {
		for (int kind = 0; kind < 6 && !expired(); kind++) {
			seed = seed * 6364136223846793005ULL + 1442695040888963407ULL;
			for (i = 0; i < n; i++)
				buf[i] = pat(kind, i, seed);
			for (i = 0; i < n; i++) {
				uint64_t want = pat(kind, i, seed), got = buf[i];
				if (got != want) {
					uint64_t x = got ^ want;
					mem_errors++;
					printf("ERROR mem pattern %d offset 0x%zx (line+%zu) want %016llx got %016llx flipped %016llx (%s)\n",
					       kind, i * 8, (i * 8) % 64, (unsigned long long)want,
					       (unsigned long long)got, (unsigned long long)x,
					       (got & x) ? "0->1" : "1->0");
					fflush(stdout);
					buf[i] = want;
				}
			}
		}
		mem_passes++;
	}
	return NULL;
}

/* ---- cpu ---- */

#define WS (192 * 1024 / 8)	/* working set larger than L1, inside L2 */

static uint64_t workload(uint64_t *ws, uint64_t seed)
{
	uint64_t a = seed, b = ~seed, h = 0;
	double f = 1.0;

	for (int i = 0; i < WS; i++) {
		a ^= a << 13; a ^= a >> 7; a ^= a << 17;
		ws[i] = a * 0x2545f4914f6cdd1dULL;
	}
	for (int r = 0; r < 8; r++) {
		for (int i = 0; i < WS; i++) {
			uint64_t v = ws[(i * 7919 + r) % WS];
			b = (b ^ v) * 0x100000001b3ULL;
			b = (b << 29) | (b >> 35);
			ws[i] += b ^ (h >> 3);
			h += __builtin_popcountll(b) + (v >> 60);
			f = f * 1.0000001 + (double)(v & 0xff) * 1e-9;
		}
	}
	return h ^ b ^ (uint64_t)(f * 1e6);
}

static uint64_t reference[16];

static void *cpu_thread(void *arg)
{
	int id = (int)(uintptr_t)arg;
	uint64_t *ws = malloc(WS * 8);
	unsigned k = 0;

	while (!expired()) {
		uint64_t seed = 0xabcdef0123ULL + (k++ % 16);
		uint64_t got = workload(ws, seed);
		if (got != reference[seed - 0xabcdef0123ULL]) {
			cpu_errors++;
			printf("ERROR cpu thread %d seed %u got %016llx want %016llx\n", id, k % 16,
			       (unsigned long long)got,
			       (unsigned long long)reference[seed - 0xabcdef0123ULL]);
			fflush(stdout);
		}
		cpu_rounds++;
	}
	free(ws);
	return NULL;
}

/* ---- udp ---- */

static int udp(const char *ip, int port, int len)
{
	int s = socket(AF_INET, SOCK_DGRAM, 0);
	struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(port) };
	char *buf = calloc(1, len);
	unsigned long long sent = 0;
	double t0 = now(), last = t0;

	inet_pton(AF_INET, ip, &a.sin_addr);
	while (!expired()) {
		if (sendto(s, buf, len, 0, (struct sockaddr *)&a, sizeof(a)) > 0)
			sent += len;
		if (now() - last >= 10) {
			last = now();
			printf("STATUS udp %.0f Mbit/s\n", sent * 8 / (last - t0) / 1e6);
			fflush(stdout);
		}
	}
	printf("DONE udp %.0f Mbit/s average\n", sent * 8 / (now() - t0) / 1e6);
	return 0;
}

int main(int argc, char **argv)
{
	pthread_t th[17];
	int nth = 0, threads = 0;
	size_t mb = 0;
	long secs;

	signal(SIGINT, on_signal);
	signal(SIGTERM, on_signal);
	setvbuf(stdout, NULL, _IOLBF, 0);

	if (argc >= 4 && !strcmp(argv[1], "mem")) {
		mb = atol(argv[2]); secs = atol(argv[3]);
	} else if (argc >= 4 && !strcmp(argv[1], "cpu")) {
		threads = atoi(argv[2]); secs = atol(argv[3]);
	} else if (argc >= 5 && !strcmp(argv[1], "all")) {
		mb = atol(argv[2]); threads = atoi(argv[3]); secs = atol(argv[4]);
	} else if (argc >= 5 && !strcmp(argv[1], "udp")) {
		t_end = time(NULL) + atol(argv[4]);
		return udp(argv[2], atoi(argv[3]), argc > 5 ? atoi(argv[5]) : 1472);
	} else {
		fprintf(stderr, "usage: rstress mem MB SECS | cpu THREADS SECS | all MB THREADS SECS | udp IP PORT SECS [LEN]\n");
		return 1;
	}
	if (threads > 16) threads = 16;
	t_end = time(NULL) + secs;

	if (threads) {
		/* The reference answers are computed once, before any load. */
		uint64_t *ws = malloc(WS * 8);
		for (int i = 0; i < 16; i++)
			reference[i] = workload(ws, 0xabcdef0123ULL + i);
		free(ws);
		for (int i = 0; i < threads; i++)
			pthread_create(&th[nth++], NULL, cpu_thread, (void *)(uintptr_t)i);
	}
	if (mb)
		pthread_create(&th[nth++], NULL, mem_thread, (void *)(uintptr_t)(mb << 20));

	while (!expired()) {
		sleep(10);
		printf("STATUS t=%lds mem_passes=%llu mem_errors=%llu cpu_rounds=%llu cpu_errors=%llu\n",
		       (long)(secs - (t_end - time(NULL))), (unsigned long long)mem_passes,
		       (unsigned long long)mem_errors, (unsigned long long)cpu_rounds,
		       (unsigned long long)cpu_errors);
	}
	for (int i = 0; i < nth; i++)
		pthread_join(th[i], NULL);
	printf("DONE mem_passes=%llu mem_errors=%llu cpu_rounds=%llu cpu_errors=%llu\n",
	       (unsigned long long)mem_passes, (unsigned long long)mem_errors,
	       (unsigned long long)cpu_rounds, (unsigned long long)cpu_errors);
	return (mem_errors || cpu_errors) ? 2 : 0;
}
