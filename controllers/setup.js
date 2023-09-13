const twilio = require('twilio');
const context = require('../context')

const client = twilio(process.env.TWILIO_API_KEY_SID, process.env.TWILIO_API_KEY_SECRET, {
	accountSid: process.env.TWILIO_ACCOUNT_SID
});

module.exports.get = (req, res) => {
	console.log('check get')
	res.status(200).json(req.configuration);
};

module.exports.update = async (req, res) => {
	console.log('check update')
	let configuration = req.body.configuration;

	try {
		const { sid: applicationSid } = await createOrUpdateApplication(configuration.twilio.applicationSid, req);

		configuration.twilio.applicationSid = applicationSid;

		await updateChatService(req);
		console.log('skipped updateChatService')
		await syncQueues(configuration);

		const { sid: workflowSid } = await createOrUpdateWorkflow(
			configuration.twilio.workflowSid,
			configuration.queues
		);

		configuration.twilio.workflowSid = workflowSid;

		req.util.setConfiguration(configuration, (error) => {
			if (error) {
				throw error;
			} else {
				context.set({ configuration: configuration })

				res.status(200).end();
			}
		});
	} catch (error) {
		res.status(500).send(res.convertErrorToJSON(error));
	}
};

const syncQueues = async (configuration) => {
	console.log('check sync queues')
	return Promise.all(
		configuration.queues.map(async (queue) => {
			let payload = {
				sid: queue.taskQueueSid,
				friendlyName: queue.friendlyName,
				targetWorkers: `channels HAS "${queue.id}"`
			};

			const { sid } = await createOrUpdateQueue(payload);
			queue.taskQueueSid = sid;
		})
	);
};

const createOrUpdateQueue = async (queue) => {
	console.log('check createorupdatequeue')
	if (queue.sid) {
		return client.taskrouter.workspaces(process.env.TWILIO_WORKSPACE_SID).taskQueues(queue.sid).update(queue);
	} else {
		return client.taskrouter.workspaces(process.env.TWILIO_WORKSPACE_SID).taskQueues.create(queue);
	}
};

const createOrUpdateWorkflow = async (sid, queues) => {
	console.log('check couworkflow')
	let workflow = { task_routing: { filters: [] } };

	for (let i = 0; i < queues.length; i++) {
		let target = {
			queue: queues[i].taskQueueSid
		};

		if (queues[i].targetWorkerExpression) {
			target.expression = queues[i].targetWorkerExpression;
		}

		let item
		if (queues[i].id === 'phone') {
			target.timeout = 10
			target.taskReservationTimeout = 10

			const target2 = {
				espression: 'wroker.team == "callcenter"'
			}

			item = {
				targets: [target, target2],
				expression: queues[i].expression,
				filterFriendlyName: queues[i].filterFriendlyName
			}
		} else {
			item = {
				targets: [ target ],
				expression: queues[i].expression,
				filterFriendlyName: queues[i].filterFriendlyName
			};

		}

		workflow.task_routing.filters.push(item);
	}

	const payload = {
		sid: sid,
		friendlyName: 'Twilio Contact Center Workflow',
		taskReservationTimeout: 1200,
		configuration: JSON.stringify(workflow)
	};

	if (sid) {
		return client.taskrouter.workspaces(process.env.TWILIO_WORKSPACE_SID).workflows(sid).update(payload);
	} else {
		return client.taskrouter.workspaces(process.env.TWILIO_WORKSPACE_SID).workflows.create(payload);
	}
};

const createOrUpdateApplication = async (sid, req) => {
	console.log('check couApplication')
	const payload = {
		friendlyName: 'Twilio Contact Center Demo',
		voiceUrl: `${req.protocol}://${req.hostname}/api/phone/call`,
		voiceMethod: 'POST'
	};

	if (sid) {
		return client.applications(sid).update(payload);
	} else {
		return client.applications.create(payload);
	}
};

const updateChatService = async (req) => {
	console.log('check updateChatService')
	let webhooks = {};

	webhooks.postWebhookUrl = `${req.protocol}://${req.hostname}/api/messaging-adapter/outbound`;
	webhooks.webhookFilters = 'onMessageSent';
	webhooks.webhookMethod = 'POST';
	webhooks.friendlyName = 'Test Chat Service'

	return client.chat.services(process.env.TWILIO_CHAT_SERVICE_SID).update(webhooks);
};
