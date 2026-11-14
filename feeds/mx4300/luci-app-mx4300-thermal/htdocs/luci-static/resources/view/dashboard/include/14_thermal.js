'use strict';
'require baseclass';
'require thermal';
'require view.dashboard.lib.charts as charts';

return baseclass.extend({
	widgets: [
		{ id: 'thermal', slot: 'cards', title: _('Temperature'), order: 35 },
		{ id: 'thermal', slot: 'tabs', title: _('Temperature'), order: 35 }
	],

	load() {
		return Promise.all([ thermal.load() ]);
	},

	renderCard(sensors) {
		const hottest = sensors.reduce((max, s) => (max == null || s.temp > max.temp) ? s : max, null);

		return charts.kpi({
			icon: 'thermometer',
			title: _('Temperature'),
			value: [ hottest ? thermal.format(hottest.temp) : '-' ],
			sub: hottest
				? thermal.summary(sensors).map(g => '%s %s'.format(g.group, thermal.format(g.temp)))
				: [ _('No sensors') ]
		});
	},

	renderTab(sensors) {
		if (!sensors.length)
			return charts.empty(_('No temperature sensors found'));

		return E('table', { 'class': 'table' }, sensors.map(s => E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'width': '33%' }, [ s.label ]),
			E('td', { 'class': 'td left' }, [
				thermal.format(s.temp),
				(s.passive != null) ? E('small', {}, [ ' · ', _('throttles at %s').format(thermal.format(s.passive)) ]) : ''
			])
		])));
	},

	render([ sensors ]) {
		return {
			cards: [ { id: 'thermal', node: () => this.renderCard(sensors) } ],
			tabs: [ { id: 'thermal', title: _('Temperature'), content: () => this.renderTab(sensors) } ]
		};
	}
});
