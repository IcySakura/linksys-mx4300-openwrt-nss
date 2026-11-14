'use strict';
'require baseclass';
'require rpc';

/* Shared by the Dashboard card and the Status -> Overview section: reads
   /usr/share/rpcd/ucode/luci.thermal and names the sensors. */

const callThermal = rpc.declare({ object: 'luci.thermal', method: 'get' });

const GROUPS = [
	[ /^(cpu[0-9]+|cluster)$/, _('CPU') ],
	[ /^nss/,                  _('NSS') ],
	[ /^(wcss|phy[0-9])/,      _('Wi-Fi') ]
];

function label(s) {
	let m;

	if ((m = s.name.match(/^cpu([0-9]+)$/)))
		return _('CPU core %d').format(+m[1]);
	if (s.name == 'cluster')
		return _('CPU cluster');
	if (s.name == 'nss-top')
		return _('NSS');
	if ((m = s.name.match(/^nss([0-9]+)$/)))
		return _('NSS core %d').format(+m[1]);
	if ((m = s.name.match(/^wcss-phy([ab])([0-9]+)$/)))
		return _('Wi-Fi block %s%d').format(m[1].toUpperCase(), +m[2]);
	if (s.radio)
		return _('Wi-Fi radio %s').format(s.name);

	return s.name;
}

function group(s) {
	for (let i = 0; i < GROUPS.length; i++)
		if (GROUPS[i][0].test(s.name))
			return GROUPS[i][1];

	return _('Other');
}

return baseclass.extend({
	load() {
		return L.resolveDefault(callThermal(), {}).then(res => {
			const zones = L.toArray(res.zones);
			const radios = L.toArray(res.radios).map(r => Object.assign(r, { radio: true }));
			const all = zones.concat(radios).map(s => Object.assign(s, { label: label(s), group: group(s) }));

			return all.sort((a, b) => GROUPS.findIndex(g => g[1] == a.group) - GROUPS.findIndex(g => g[1] == b.group)
				|| a.label.localeCompare(b.label, undefined, { numeric: true }));
		});
	},

	// Hottest sensor per group, in GROUPS order
	summary(sensors) {
		const max = {};

		sensors.forEach(s => { if (max[s.group] == null || s.temp > max[s.group]) max[s.group] = s.temp; });

		return Object.keys(max).map(g => ({ group: g, temp: max[g] }));
	},

	format(temp) {
		return (temp != null) ? '%.0f °C'.format(temp) : '-';
	}
});
