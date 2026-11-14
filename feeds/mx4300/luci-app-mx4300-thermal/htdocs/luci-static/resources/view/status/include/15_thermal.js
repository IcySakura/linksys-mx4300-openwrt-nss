'use strict';
'require baseclass';
'require thermal';

return baseclass.extend({
	title: _('Temperature'),

	load() {
		return thermal.load();
	},

	render(sensors) {
		if (!sensors.length)
			return null;

		return E('table', { 'class': 'table' }, sensors.map(s => E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'width': '33%' }, [ s.label ]),
			E('td', { 'class': 'td left' }, [
				thermal.format(s.temp),
				(s.passive != null) ? ' (%s)'.format(_('throttles at %s').format(thermal.format(s.passive))) : ''
			])
		])));
	}
});
