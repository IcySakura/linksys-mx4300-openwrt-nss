'use strict';
'require baseclass';
'require fs';

const CORE0_PATH = '/sys/bus/platform/drivers/nss-wifi-drv/39000000.nss/load';
const CORE1_PATH = '/sys/bus/platform/drivers/nss-wifi-drv/39400000.nss/load';

function parseLoad(text) {
	if (!text)
		return null;

	const runMatch = text.match(/^running:\s*(\d+)/m);
	if (runMatch && runMatch[1] === '0')
		return { running: false };

	const freqMatch = text.match(/^freq_hz:\s*(\d+)/m);
	const pctMatch = text.match(/^load_pct:\s*avg\s+(\d+)\s+min\s+(\d+)\s+max\s+(\d+)/m);
	if (!pctMatch)
		return null;

	return {
		running: true,
		freq: freqMatch ? Number(freqMatch[1]) : 0,
		avg: Number(pctMatch[1]),
		min: Number(pctMatch[2]),
		max: Number(pctMatch[3])
	};
}

function progressbar(percent, label) {
	const pc = Math.max(0, Math.min(100, percent));
	return E('div', { 'class': 'cbi-progressbar', 'title': label }, [
		E('div', { 'style': 'width:%.2f%%'.format(pc) })
	]);
}

return baseclass.extend({
	title: _('NSS Cores'),

	load() {
		return Promise.all([
			L.resolveDefault(fs.trimmed(CORE0_PATH), null),
			L.resolveDefault(fs.trimmed(CORE1_PATH), null)
		]);
	},

	render([raw0, raw1]) {
		const c0 = parseLoad(raw0);
		const c1 = parseLoad(raw1);
		if (!c0 && !c1)
			return null;

		const rows = [];
		const addRow = (name, c) => {
			if (!c)
				return;
			if (!c.running) {
				rows.push([name, E('em', {}, [_('Halted')])]);
				return;
			}
			const freq = c.freq ? ' @ %.0f MHz'.format(c.freq / 1e6) : '';
			rows.push([
				name,
				progressbar(c.avg, '%d%% (min %d%%, max %d%%%s)'.format(c.avg, c.min, c.max, freq))
			]);
		};

		addRow(_('Core 0 (Wi-Fi / flows)'), c0);
		addRow(_('Core 1 (Crypto / IPsec)'), c1);

		return E('table', { 'class': 'table' }, rows.map(row =>
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, [row[0]]),
				E('td', { 'class': 'td left' }, [row[1]])
			])
		));
	}
});
