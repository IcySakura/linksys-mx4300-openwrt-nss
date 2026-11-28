'use strict';
'require baseclass';
'require fs';
'require view.dashboard.lib.charts as charts';

const CORE0_PATH = '/sys/bus/platform/drivers/nss-wifi-drv/39000000.nss/load';
const CORE1_PATH = '/sys/bus/platform/drivers/nss-wifi-drv/39400000.nss/load';
const SPAN_SEC = 300;
const MAX_POINTS = 150;

const samples = [];

function parseLoad(text) {
	if (!text)
		return null;

	const runMatch = text.match(/^running:\s*(\d+)/m);
	if (runMatch && runMatch[1] === '0')
		return { running: false };

	const freqMatch = text.match(/^freq_hz:\s*(\d+)/m);
	const pctMatch = text.match(/^load_pct:\s*avg\s+(\d+)\s+min\s+(\d+)\s+max\s+(\d+)(?:\s+\(raw_avg\s+(\d+)%\))?/m);
	const instMatch = text.match(/^inst_per_ms:\s*avg\s+(\d+)\s+min\s+(\d+)\s+max\s+(\d+)\s*\/\s*(\d+)/m);
	if (!pctMatch)
		return null;

	return {
		running: true,
		freq: freqMatch ? Number(freqMatch[1]) : 0,
		avg: Number(pctMatch[1]),
		min: Number(pctMatch[2]),
		max: Number(pctMatch[3]),
		raw: pctMatch[4] != null ? Number(pctMatch[4]) : null,
		instAvg: instMatch ? Number(instMatch[1]) : 0,
		instCap: instMatch ? Number(instMatch[4]) : 0
	};
}

function progressbar(percent, text) {
	return E('div', { 'class': 'cbi-progressbar', 'title': text }, [
		E('div', { 'style': 'width:%.2f%%'.format(Math.max(0, Math.min(100, percent))) })
	]);
}

function recordSample(c0, c1) {
	if (!c0 && !c1)
		return;

	const now = Date.now();
	samples.push({
		t: now,
		c0: (c0 && c0.running) ? c0.avg : null,
		c1: (c1 && c1.running) ? c1.avg : null
	});

	const cutoff = now - SPAN_SEC * 1000;
	while (samples.length > MAX_POINTS || (samples.length > 1 && samples[0].t < cutoff))
		samples.shift();
}

function coreTooltip(c) {
	const parts = [
		'min %d%% · avg %d%% · max %d%%'.format(c.min, c.avg, c.max)
	];
	if (c.raw != null)
		parts.push('raw %d%%'.format(c.raw));
	if (c.freq)
		parts.push('%.0f MHz'.format(c.freq / 1e6));
	if (c.instCap)
		parts.push('%d / %d inst/ms'.format(c.instAvg, c.instCap));
	return parts.join(' · ');
}

return baseclass.extend({
	widgets: [
		{ id: 'nss', slot: 'cards', title: _('NSS cores'), order: 25 },
		{ id: 'nss_load', slot: 'charts', title: _('NSS load'), order: 25 },
		{ id: 'nss', slot: 'tabs', title: _('NSS'), order: 35 }
	],

	load() {
		return Promise.all([
			L.resolveDefault(fs.trimmed(CORE0_PATH), null),
			L.resolveDefault(fs.trimmed(CORE1_PATH), null)
		]).then(([raw0, raw1]) => {
			const c0 = parseLoad(raw0);
			const c1 = parseLoad(raw1);
			recordSample(c0, c1);
			return [c0, c1];
		});
	},

	renderCard(c0, c1) {
		const active0 = c0 && c0.running;
		const active1 = c1 && c1.running;
		let value = '-';
		if (active0 && active1)
			value = '%d%% / %d%%'.format(c0.avg, c1.avg);
		else if (active0)
			value = '%d%%'.format(c0.avg);
		else if (active1)
			value = '%d%%'.format(c1.avg);

		const sub = [];
		const freq = (active0 && c0.freq) ? c0.freq : (active1 && c1.freq ? c1.freq : 0);
		if (freq)
			sub.push('%.0f MHz'.format(freq / 1e6));
		if (active0 && active1)
			sub.push(_('Core 0 · Core 1'));
		else if (active0)
			sub.push(_('Core 0 · Core 1 off'));
		else
			sub.push(_('Halted'));

		return charts.kpi({
			icon: 'cpu',
			title: _('NSS cores'),
			value: [value],
			sub: sub
		});
	},

	renderChart(c0, c1) {
		const s0 = samples.map(p => ({ t: p.t, v: p.c0 }));
		const s1 = samples.map(p => ({ t: p.t, v: p.c1 }));
		const hasData = s0.some(p => p.v != null) || s1.some(p => p.v != null);
		const hasC1 = s1.some(p => p.v != null);
		const fmtPct = v => (v != null) ? '%d%%'.format(Math.round(v)) : '-';
		const freq = (c0 && c0.running && c0.freq) ? c0.freq : ((c1 && c1.running && c1.freq) ? c1.freq : 0);

		const series = [{ values: s0, area: true }];
		const legend = [{
			className: 'dashboard-series-1',
			label: _('Core 0'),
			value: fmtPct(c0 && c0.running ? c0.avg : null)
		}];

		if (hasC1 || (c1 && c1.running)) {
			series.push({ values: s1 });
			legend.push({
				className: 'dashboard-series-2',
				label: _('Core 1'),
				value: fmtPct(c1 && c1.running ? c1.avg : null)
			});
		}

		return charts.card({
			title: _('NSS load'),
			desc: freq ? '%.0f MHz'.format(freq / 1e6) : '',
			body: hasData ? [
				charts.lines({
					span: SPAN_SEC,
					max: 100,
					ticks: [0, 25, 50, 75, 100].map(v => ({ value: v, label: '%d%%'.format(v) })),
					ariaLabel: _('NSS load'),
					series: series
				}),
				charts.legend(legend)
			] : charts.empty(_('Collecting samples…'))
		});
	},

	renderTab(c0, c1) {
		const rows = [];
		const addCore = (label, role, c) => {
			if (!c)
				return;
			if (!c.running) {
				rows.push([
					'%s (%s)'.format(label, role),
					E('em', {}, [_('Halted')])
				]);
				return;
			}
			rows.push([
				E('span', { 'data-tooltip': coreTooltip(c) }, [
					'%s (%s)'.format(label, role)
				]),
				progressbar(c.avg, '%d%% (min %d%%, max %d%%)'.format(c.avg, c.min, c.max))
			]);
		};

		addCore(_('NSS Core 0'), _('Wi-Fi / flows'), c0);
		addCore(_('NSS Core 1'), _('Crypto / IPsec'), c1);

		const freq = (c0 && c0.running && c0.freq) ? c0.freq : ((c1 && c1.running && c1.freq) ? c1.freq : 0);
		if (freq)
			rows.push([_('Clock frequency'), '%.1f MHz'.format(freq / 1e6)]);

		return E('table', { 'class': 'table' }, rows.map(row =>
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, [row[0]]),
				E('td', { 'class': 'td left' }, [row[1]])
			])
		));
	},

	render([c0, c1]) {
		if (!c0 && !c1)
			return null;

		return {
			cards: [{ id: 'nss', node: () => this.renderCard(c0, c1) }],
			charts: [{ id: 'nss_load', node: () => this.renderChart(c0, c1) }],
			tabs: [{ id: 'nss', title: _('NSS'), content: () => this.renderTab(c0, c1) }]
		};
	}
});
