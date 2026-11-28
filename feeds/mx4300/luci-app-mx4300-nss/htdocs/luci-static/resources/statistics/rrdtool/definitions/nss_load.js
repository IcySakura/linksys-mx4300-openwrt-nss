'use strict';
'require baseclass';

return baseclass.extend({
	title: _('NSS Cores'),

	rrdargs(graph, host, plugin, plugin_instance, dtype) {
		return {
			title: '%H: NSS %pi utilization',
			y_min: '0',
			y_max: '10',
			alt_autoscale_max: true,
			vlabel: 'Percent',
			number_format: '%5.1lf%%',
			data: {
				instances: {
					percent: ['active', 'peak']
				},
				options: {
					percent_active: {
						color: '00a0e0',
						title: 'Average'
					},
					percent_peak: {
						color: 'ff8000',
						title: 'Peak',
						noarea: true
					}
				}
			}
		};
	}
});
