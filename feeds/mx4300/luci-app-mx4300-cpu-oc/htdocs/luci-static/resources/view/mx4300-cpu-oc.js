'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require uci';
'require poll';
'require view.dashboard.lib.charts as charts';

/* System -> CPU Overclock: settings in /etc/config/mx4300-cpu-oc, applied by
   the mx4300-cpu-oc service on save; status, the stability test and tuning
   through /usr/sbin/mx4300-cpu-oc. */

const CMD = '/usr/sbin/mx4300-cpu-oc';
const FAMILY_MAX = 2208000;
const LEVELS = {
	1: _('1017.6 MHz'),
	2: _('1382.4 MHz'),
	3: _('1497.6–1651.2 MHz'),
	4: _('1843.2 MHz'),
	5: _('1920 MHz'),
	6: _('2073.6 MHz and above')
};
/* Level-6 offsets that worked on the MX4300 these were measured on, plus a
   margin. Other chips differ. */
const EXTREME_OFFSET = {
	2304000: 32, 2400000: 32, 2496000: 32, 2592000: 96, 2688000: 128
};

/* CPR level of a speed, as in the device tree (and mx4300-cpu-oc) */
function levelOf(khz) {
	return (khz <= 1017600) ? 1 : (khz <= 1382400) ? 2 : (khz <= 1651200) ? 3 :
		(khz <= 1843200) ? 4 : (khz <= 1920000) ? 5 : 6;
}

function exec(args) {
	return fs.exec(CMD, args).then(res => (res.code === 0) ? JSON.parse(res.stdout) : null).catch(() => null);
}

function run(args) {
	return fs.exec(CMD, args).then(res => {
		if (res.code !== 0)
			ui.addNotification(null, E('p', {}, (res.stderr || '').trim() || _('The command failed')), 'error');
		return res.code === 0;
	});
}

function mhz(khz) {
	return '%.1f MHz'.format(khz / 1000);
}

function mv(uv) {
	return uv ? '%d mV'.format(Math.round(uv / 1000)) : '–';
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
		E('p', {}, [ E('strong', {}, _('Benefits: ')), _('up to 60% more CPU speed at 2208 MHz for work the CPU does itself: Passwall and Xray proxying and their encryption, VPNs, DNS, the web interface. Wired routing and Wi-Fi run on the offload hardware and do not get faster. The CPU only speeds up when there is work to do; idle, it stays at 1017.6 MHz.') ]),
		E('p', {}, [ E('strong', {}, _('Risks: ')), _('this is outside Qualcomm\'s specification. Every chip is different: above its own limit the CPU can make silent calculation errors or crash. Higher speeds mean more heat and power use and may shorten the chip\'s life. There is no warranty.') ]),
		E('p', {}, [ E('strong', {}, _('Safeguards: ')), _('overclocking is off unless you turn it on. Run the stability test after choosing a speed: a failed test undoes the change. If the router crashes or hangs while overclocked, the next boot goes back to the last settings that passed a stability test (or turns overclocking off) and tells you here. A power cut does not count as a crash.') ])
	]);
}

function extremeWarning() {
	return E('div', { 'class': 'alert-message error' }, [
		E('h4', {}, _('Extreme speeds (above 2208 MHz)')),
		E('p', {}, _('No chip of this family is sold for more than 2208 MHz, and the voltage controller has no calibration data for faster speeds, so these need a raised voltage on the top level (offset 6). They were tested on one MX4300 only: 2304–2496 MHz ran at the normal voltage, 2592 MHz needed +64 mV, 2688 MHz needed +96 mV, and 2784 MHz crashed even at the 1064 mV maximum. Expect your chip to differ; expect crashes while you find its limit; the extra voltage means extra heat and wear.'))
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
		const tu = st.tune || {};

		add(_('Mode'), (st.boost && st.limit_freq > st.stock_max)
			? _('Overclocked, up to %s (%s)').format(mhz(st.limit_freq), gain(st.limit_freq, st.stock_max))
			: _('Stock, up to %s').format(mhz(st.stock_max)));
		add(_('CPU speed now'), mhz(st.cur_freq));
		add(_('CPU voltage now'), mv(st.cur_volt));
		add(_('CPU temperature'), '%.1f °C'.format(st.temp / 1000));
		if (t.state && t.state != 'none')
			add(_('Last stability test'), (t.state == 'running')
				? _('running at %s for %d s (started %s)').format(mhz(t.khz), t.seconds, when(t.time))
				: (t.state == 'passed')
					? _('passed at %s, %d s, peak %.1f °C (%s)').format(mhz(t.khz), t.seconds, (t.max_temp || 0) / 1000, when(t.time))
					: _('FAILED at %s: %d errors (%s)').format(mhz(t.khz), t.errors || 0, when(t.time)));
		if (tu.state && tu.state != 'none')
			add(_('Tuning'), (tu.state == 'running')
				? _('%s tuning running: %d steps so far, %d crashes; now: %s').format(tu.job, tu.steps, tu.crashes, tu.current || '…')
				: _('%s tuning %s: %s').format(tu.job, tu.state, tu.result || '–'));

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Status')),
			st.disabled_reason ? E('div', { 'class': 'alert-message error' }, [ st.disabled_reason ]) : '',
			E('table', { 'class': 'table' }, rows)
		]);
	},

	/* Speed against voltage, drawn with LuCI Dashboard's line chart (its
	   x axis is time; speeds in MHz map onto it linearly). */
	renderCurve(st) {
		const speeds = st.stock_freqs.concat(st.boost_freqs).sort((a, b) => a - b);
		const volt = {}, low = {};
		const BASE = 600;	/* mV at the bottom of the plot */
		const top = 1100;

		st.levels.forEach(l => {
			volt[l.level] = l.volt / 1000;
			/* lowest stable voltage measured by voltage tuning */
			if (l.min_offset != null)
				low[l.level] = (l.volt - l.offset + l.min_offset) / 1000;
		});
		if (!speeds.length || !volt[1])
			return '';

		const lo = speeds[0] / 1000, hi = speeds[speeds.length - 1] / 1000;
		const point = khz => ({ t: khz / 1000, v: volt[levelOf(khz)] - BASE });
		const inUse = speeds.filter(f => f <= st.limit_freq).map(point);
		const rest = speeds.filter(f => f >= st.limit_freq).map(point);
		const tuned = speeds.filter(f => low[levelOf(f)] != null)
			.map(f => ({ t: f / 1000, v: low[levelOf(f)] - BASE }));
		const x = mhzv => 100 * (mhzv - lo) / (hi - lo);
		/* where each voltage level starts */
		const starts = speeds.filter((f, i) => i == 0 || levelOf(f) != levelOf(speeds[i - 1]));

		return charts.card({
			title: _('Speed and voltage'),
			desc: _('The CPU voltage the voltage controller uses at each speed this firmware offers (now: %s at %s). Higher speeds need more voltage; the line steps up where a new voltage level (L1–L6) starts. After voltage tuning, a third line shows the lowest voltage that passed on each level: the gap between the lines is the safety margin.').format(mv(st.cur_volt), mhz(st.cur_freq)),
			body: [
				charts.lines({
					span: (hi - lo) / 1000,
					max: top - BASE,
					ticks: [ 700, 800, 900, 1000, 1064 ].map(v => ({ value: v - BASE, label: '%d mV'.format(v) })),
					ariaLabel: _('Speed and voltage'),
					series: [ { values: inUse }, { values: (rest.length > 1) ? rest : [] }, { values: tuned },
						{ values: (st.cap_uv && st.cap_uv < 1064000) ? [ { t: lo, v: st.cap_uv / 1000 - BASE }, { t: hi, v: st.cap_uv / 1000 - BASE } ] : [] } ]
				}),
				/* level markers and speed labels, positioned along the same x axis */
				E('div', { 'style': 'position:relative;height:2.6em;font-size:85%;margin:2px 0 6px' },
					starts.map(f => E('span', {
						'style': 'position:absolute;left:%.2f%%;transform:translateX(%s);white-space:nowrap;opacity:.75'
							.format(x(f / 1000), (f == speeds[0]) ? '0' : (f == speeds[speeds.length - 1]) ? '-100%' : '-50%'),
						'title': _('Voltage level %d starts at %s').format(levelOf(f), mhz(f))
					}, [ E('div', {}, '│ L%d'.format(levelOf(f))), E('div', {}, '%d MHz'.format(Math.round(f / 1000))) ]))),
				charts.legend([
					{ className: 'dashboard-series-1', label: _('Allowed now'), value: _('up to %s').format(mhz(st.limit_freq)) },
					{ className: 'dashboard-series-2', label: _('Available, not allowed'), value: (rest.length > 1) ? _('up to %s').format(mhz(speeds[speeds.length - 1])) : null },
					tuned.length ? { className: 'dashboard-series-3', label: _('Lowest stable (voltage tuning)'), value: null } : null,
					(st.cap_uv && st.cap_uv < 1064000) ? { className: 'dashboard-series-4', label: _('Voltage limit'), value: mv(st.cap_uv) } : null
				].filter(i => i))
			]
		});
	},

	renderLevels(st) {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Voltage levels')),
			E('p', {}, _('The voltage controller (CPR) sets each level from on-chip measurements, between a floor and a ceiling; an offset moves all three. Limits: 592–1064 mV.')),
			E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Level')), E('th', { 'class': 'th' }, _('Speeds')),
					E('th', { 'class': 'th' }, _('Offset')), E('th', { 'class': 'th' }, _('Voltage')),
					E('th', { 'class': 'th' }, _('Floor – ceiling'))
				])
			].concat(st.levels.map(l => E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ l.level ]), E('td', { 'class': 'td' }, [ LEVELS[l.level] ]),
				E('td', { 'class': 'td' }, [ '%+d mV'.format(Math.round(l.offset / 1000)) ]),
				E('td', { 'class': 'td' }, [ mv(l.volt) ]),
				E('td', { 'class': 'td' }, [ '%s – %s'.format(mv(l.floor), mv(l.ceiling)) ])
			]))))
		]);
	},

	renderTest(st) {
		const speeds = st.stock_freqs.concat(st.boost_freqs).filter(f => f <= st.effective_max || !st.enabled);
		const speed = E('select', { 'class': 'cbi-input-select' }, speeds.map(f =>
			E('option', { 'value': f, 'selected': (f == st.effective_max) ? '' : null }, '%s (%s)'.format(mhz(f), gain(f, st.stock_max)))));
		const dur = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 60 }, _('1 minute')),
			E('option', { 'value': 300, 'selected': '' }, _('5 minutes')),
			E('option', { 'value': 900 }, _('15 minutes'))
		]);
		const busy = (st.test && st.test.state == 'running') || (st.tune && st.tune.state == 'running');

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Stability test')),
			E('p', {}, _('Holds the CPU at the chosen speed under a full CPU and memory load and checks every result. Run it at your highest speed after any change; 15 minutes is a stronger test than 1. The router stays usable but slower while it runs.')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Speed')), E('div', { 'class': 'cbi-value-field' }, [ speed ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Duration')), E('div', { 'class': 'cbi-value-field' }, [ dur ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, ' '), E('div', { 'class': 'cbi-value-field' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'disabled': busy ? '' : null,
					'click': ui.createHandlerFn(this, () => run([ 'test', dur.value, speed.value ]))
				}, _('Start stability test'))
			]) ])
		]);
	},

	renderTune(st) {
		const tu = st.tune || {};
		const running = tu.state == 'running';
		const confirmRun = (kind, text) => ui.showModal(_('Start tuning?'), [
			E('p', {}, text),
			E('p', {}, _('The router will crash and restart while tuning, possibly several times: each time the internet and Wi-Fi drop for about two minutes. Tuning continues by itself after every restart. Do not use the router for anything important until it is done.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, () => {
					ui.hideModal();
					return run([ 'tune', kind ]);
				}) }, _('Start'))
			])
		]);

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Automatic tuning')),
			E('p', {}, _('Measures this router\'s own limits with one-minute stress tests per step, then confirms the result with a ten-minute test and saves it (switching to advanced mode).')),
			E('ul', {}, [
				E('li', {}, [ E('strong', {}, _('Find my maximum speed: ')), _('tries each speed from the bottom up and keeps the highest that passes. With "Allow extreme speeds" ticked it continues past 2208 MHz, raising the top voltage level 32 mV at a time up to the 1064 mV limit. About 10–40 minutes.') ]),
				E('li', {}, [ E('strong', {}, _('Lower voltages automatically: ')), _('for every voltage level in use, lowers the offset 16 mV at a time until a test fails, then keeps the lowest passing value plus 32 mV of margin (never above the starting value). Less heat and power; your chip\'s own curve instead of CPR\'s generic margin. About 30–60 minutes.') ])
			]),
			E('div', {}, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action', 'disabled': running ? '' : null,
					'click': () => confirmRun('speed', _('Find the highest stable speed for this router.'))
				}, _('Find my maximum speed')), ' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-action', 'disabled': (running || !st.enabled) ? '' : null,
					'click': () => confirmRun('voltage', _('Find the lowest stable voltages for the speeds in use (up to %s).').format(mhz(st.effective_max)))
				}, _('Lower voltages automatically')), ' ',
				running ? E('button', { 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, () => run([ 'tune', 'stop' ])) }, _('Stop tuning')) : ''
			]),
			(tu.log && tu.log.length)
				? E('pre', { 'style': 'max-height:16em;overflow:auto;margin-top:1em' }, tu.log.join('\n'))
				: ''
		]);
	},

	render([ st ]) {
		if (!st)
			return E('div', { 'class': 'alert-message error' }, _('mx4300-cpu-oc is not available.'));

		const m = new form.Map('mx4300-cpu-oc', _('CPU Overclock'),
			_('Lets the CPU run faster than the stock 1382.4 MHz. Off by default.'));
		const s = m.section(form.NamedSection, 'main', 'cpu-oc', _('Settings'));
		const advanced = uci.get('mx4300-cpu-oc', 'main', 'mode') == 'advanced';
		let o;

		o = s.option(form.Flag, 'enabled', _('Allow overclocking'),
			_('The CPU still idles at 1017.6 MHz and only speeds up under load.'));
		o.write = function(sid, value) {
			if (value == '1')
				uci.unset('mx4300-cpu-oc', sid, 'disabled_reason');
			return form.Flag.prototype.write.apply(this, [ sid, value ]);
		};

		o = s.option(form.ListValue, 'mode', _('Mode'),
			_('Simple: a preset, voltages fully automatic. Advanced: any speed, voltage offsets, extreme speeds and automatic tuning.'));
		o.value('simple', _('Simple'));
		o.value('advanced', _('Advanced'));
		o.default = 'simple';

		o = s.option(form.ListValue, 'preset', _('Preset'));
		o.value('balanced', _('Balanced: up to 1843.2 MHz (+33%)'));
		o.value('performance', _('Performance: up to 2208 MHz (+60%)'));
		o.default = 'performance';
		o.depends('mode', 'simple');

		o = s.option(form.ListValue, 'volt_cap', _('Voltage limit'),
			_('No voltage level may run above this, whatever the offsets and the tuning say. Wear on a chip comes from voltage and heat, not from speed: within the limit, a speed that is too high causes calculation errors or crashes (which the stability test and tuning catch), not damage.'));
		o.value('family', _('Family normal: 944 mV (recommended) – what this chip family runs at its stock 2208 MHz'));
		o.value('chip', _('This chip\'s stock: 776 mV – never above what stock firmware gives this router'));
		o.value('none', _('None: up to the 1064 mV hard limit (needed for most extreme speeds)'));
		o.default = 'family';
		o.depends('mode', 'advanced');

		o = s.option(form.Flag, 'extreme', _('Allow extreme speeds'),
			_('Speeds above 2208 MHz. Read the warning below first.'));
		o.depends('mode', 'advanced');

		o = s.option(form.ListValue, 'max_freq', _('Highest speed'),
			_('Each chip has its own limit. Run the stability test at this speed after saving.'));
		st.boost_freqs.forEach(f => {
			const label = '%s (%s)%s'.format(mhz(f), gain(f, st.stock_max),
				(f > FAMILY_MAX) ? _(' – extreme, recommended offset 6: +%d mV').format(EXTREME_OFFSET[f] || 128) : '');
			o.value(f, label);
		});
		o.default = '2208000';
		o.depends('mode', 'advanced');
		o.validate = function(sid, value) {
			const ext = this.section.formvalue(sid, 'extreme');
			return (+value > FAMILY_MAX && ext != '1') ? _('Tick "Allow extreme speeds" to use this speed') : true;
		};

		Object.keys(LEVELS).forEach(l => {
			o = s.option(form.Value, 'offset_' + l, _('Voltage offset, level %s').format(l),
				_('%s. In mV, 8 mV steps; 0 = automatic (recommended).').format(LEVELS[l]) +
				((l == 6) ? ' ' + _('Extreme speeds need a positive value here.') : ''));
			o.datatype = 'range(-160,128)';
			o.placeholder = '0';
			o.cfgvalue = function(sid) {
				const v = uci.get('mx4300-cpu-oc', sid, this.option);
				return v ? String(Math.round(+v / 1000)) : null;
			};
			o.write = function(sid, value) {
				const mvv = Math.round(+value / 8) * 8;
				return uci.set('mx4300-cpu-oc', sid, this.option, String(mvv * 1000));
			};
			o.remove = function(sid) {
				return uci.unset('mx4300-cpu-oc', sid, this.option);
			};
			o.depends('mode', 'advanced');
		});

		return m.render().then(node => {
			/* Status, voltage levels and tuning refresh every 5 s; the test
			   section keeps its selections and is built once. */
			const status = E('div', {}, [ this.renderStatus(st), this.renderCurve(st) ]);
			const levels = E('div', {}, (advanced && st.voltage_control) ? [ this.renderLevels(st) ] : []);
			const tune = E('div', {}, advanced ? [ this.renderTune(st) ] : []);

			poll.add(() => exec([ 'status' ]).then(nst => {
				if (!nst)
					return;
				status.replaceChildren(this.renderStatus(nst), this.renderCurve(nst));
				if (advanced && nst.voltage_control)
					levels.replaceChildren(this.renderLevels(nst));
				if (advanced)
					tune.replaceChildren(this.renderTune(nst));
			}), 5);

			return E([], [
				E('link', { 'rel': 'stylesheet', 'href': L.resource('view/dashboard/css/custom.css') }),
				warning(),
				(advanced && uci.get('mx4300-cpu-oc', 'main', 'extreme') == '1') ? extremeWarning() : '',
				status, node, levels, this.renderTest(st), tune
			]);
		});
	}
});
