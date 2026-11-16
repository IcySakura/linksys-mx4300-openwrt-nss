'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require uci';
'require poll';

/* System -> CPU Overclock: settings in /etc/config/mx4300-cpu-oc, applied by
   the mx4300-cpu-oc service on save; status and the stability test through
   /usr/sbin/mx4300-cpu-oc. */

const CMD = '/usr/sbin/mx4300-cpu-oc';

function exec(args) {
	return fs.exec(CMD, args).then(res => (res.code === 0) ? JSON.parse(res.stdout) : null).catch(() => null);
}

function mhz(khz) {
	return '%.1f MHz'.format(khz / 1000);
}

function gain(khz, stock) {
	const p = Math.round((khz / stock - 1) * 100);

	return (p > 0) ? '+%d%%'.format(p) : _('stock');
}

function when(t) {
	return t ? new Date(t * 1000).toLocaleString() : '';
}

function warning() {
	return E('div', { 'class': 'alert-message warning' }, [
		E('h4', {}, _('Read this before turning overclocking on')),
		E('p', {}, _('Qualcomm rates this router\'s IPQ8174 processor for 1.4 GHz, and the stock firmware never runs it faster than 1382.4 MHz. The chip\'s own CPU clock generator refuses to go higher, but the CPU itself can run faster: this firmware can feed it from a second clock generator on the chip, up to 2208 MHz, the speed of the 2.2 GHz models of the same chip family. The CPU voltage still comes from the chip\'s own voltage controller (CPR), which sets it for every speed from measurements of this particular chip.')),
		E('p', {}, [ E('strong', {}, _('Benefits: ')), _('up to 60% more CPU speed (2208 MHz against 1382.4 MHz) for work the CPU does itself: Passwall and Xray proxying and their encryption, VPNs, DNS, the web interface. Wired routing and Wi-Fi run on the offload hardware and do not get faster. The CPU only speeds up when there is work to do; idle, it stays at 1017.6 MHz.') ]),
		E('p', {}, [ E('strong', {}, _('Risks: ')), _('this is outside Qualcomm\'s specification. Every chip is different: above its own limit the CPU can make silent calculation errors or crash. Higher speeds mean more heat and power use and may shorten the chip\'s life. There is no warranty.') ]),
		E('p', {}, [ E('strong', {}, _('Safeguards: ')), _('overclocking is off unless you turn it on. Run the stability test below after choosing a speed: a failed test turns overclocking off. If the router crashes or hangs while overclocked, it turns overclocking off at the next boot and tells you here. A power cut does not count as a crash.') ])
	]);
}

return view.extend({
	load() {
		return Promise.all([ exec([ 'status' ]), uci.load('mx4300-cpu-oc') ]);
	},

	renderStatus(st) {
		const rows = [];
		const add = (title, value) => rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'width': '33%' }, [ title ]),
			E('td', { 'class': 'td left' }, [ value ])
		]));
		const t = st.test || {};

		add(_('Mode'), (st.boost && st.limit_freq > st.stock_max)
			? _('Overclocked, up to %s (%s)').format(mhz(st.limit_freq), gain(st.limit_freq, st.stock_max))
			: _('Stock, up to %s').format(mhz(st.stock_max)));
		add(_('CPU speed now'), mhz(st.cur_freq));
		add(_('CPU temperature'), '%.1f °C'.format(st.temp / 1000));
		if (t.state && t.state != 'none')
			add(_('Last stability test'), (t.state == 'running')
				? _('running at %s for %d s (started %s)').format(mhz(t.khz), t.seconds, when(t.time))
				: (t.state == 'passed')
					? _('passed at %s, %d s, peak %.1f °C (%s)').format(mhz(t.khz), t.seconds, (t.max_temp || 0) / 1000, when(t.time))
					: _('FAILED at %s: %d errors (%s)').format(mhz(t.khz), t.errors || 0, when(t.time)));

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Status')),
			st.disabled_reason ? E('div', { 'class': 'alert-message error' }, [ st.disabled_reason ]) : '',
			E('table', { 'class': 'table', 'id': 'cpu-oc-status' }, rows)
		]);
	},

	renderTest(st) {
		const speeds = st.boost_freqs.length ? st.boost_freqs : [ st.stock_max ];
		const cfgMax = +uci.get('mx4300-cpu-oc', 'main', 'max_freq');
		const speed = E('select', { 'class': 'cbi-input-select' }, speeds.map(f =>
			E('option', { 'value': f, 'selected': (f == cfgMax) ? '' : null }, '%s (%s)'.format(mhz(f), gain(f, st.stock_max)))));
		const dur = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 60 }, _('1 minute')),
			E('option', { 'value': 300, 'selected': '' }, _('5 minutes')),
			E('option', { 'value': 900 }, _('15 minutes'))
		]);
		const btn = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'disabled': (st.test && st.test.state == 'running') ? '' : null,
			'click': ui.createHandlerFn(this, () => fs.exec(CMD, [ 'test', dur.value, speed.value ]).then(res => {
				if (res.code !== 0)
					ui.addNotification(null, E('p', {}, res.stderr || _('Could not start the test')), 'error');
				else
					btn.disabled = true;
			}))
		}, _('Start stability test'));

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Stability test')),
			E('p', {}, _('Holds the CPU at the chosen speed under a full CPU and memory load and checks every result. Run it at the speed you want before relying on it; 15 minutes is a stronger test than 1. The router stays usable but slower while it runs. A failure turns overclocking off.')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Speed')), E('div', { 'class': 'cbi-value-field' }, [ speed ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Duration')), E('div', { 'class': 'cbi-value-field' }, [ dur ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, ' '), E('div', { 'class': 'cbi-value-field' }, [ btn ]) ])
		]);
	},

	render([ st ]) {
		if (!st)
			return E('div', { 'class': 'alert-message error' }, _('mx4300-cpu-oc is not available.'));

		const m = new form.Map('mx4300-cpu-oc', _('CPU Overclock'),
			_('Lets the CPU run faster than the stock 1382.4 MHz. Off by default.'));
		const s = m.section(form.NamedSection, 'main', 'cpu-oc', _('Settings'));
		let o;

		o = s.option(form.Flag, 'enabled', _('Allow overclocking'),
			_('The CPU still idles at 1017.6 MHz and only speeds up under load, up to the speed below.'));
		o.write = function(sid, value) {
			if (value == '1')
				uci.unset('mx4300-cpu-oc', sid, 'disabled_reason');
			return form.Flag.prototype.write.apply(this, [ sid, value ]);
		};

		o = s.option(form.ListValue, 'max_freq', _('Highest speed'),
			_('Each chip has its own limit. Run the stability test at this speed after saving.'));
		st.boost_freqs.forEach(f => o.value(f, '%s (%s)'.format(mhz(f), gain(f, st.stock_max))));
		o.default = '1843200';
		o.depends('enabled', '1');

		return m.render().then(node => {
			const status = E('div', {}, [ this.renderStatus(st) ]);

			poll.add(() => exec([ 'status' ]).then(nst => {
				if (nst)
					status.replaceChildren(this.renderStatus(nst));
			}), 5);

			return E([], [ warning(), status, node, this.renderTest(st) ]);
		});
	}
});
