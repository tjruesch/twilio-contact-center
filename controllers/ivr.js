const twilio 	= require('twilio')
const http = require('http')

const taskrouterHelper = require('./helpers/taskrouter-helper.js')

module.exports.welcome = function (req, res) {
	const twiml =  new twilio.twiml.VoiceResponse()

	let keywords = []

	/* add the team names as hints to the automatic speech recognition  */
	for (let i = 0; i < req.configuration.ivr.options.length; i++) {
		keywords.push(req.configuration.ivr.options[i].friendlyName)
	}

	const gather = twiml.gather({
		input: 'dtmf speech',
		action: 'select-team',
		method: 'GET',
		numDigits: 1,
		timeout: 2,
		language: 'en-US',
		hints: keywords.join()
	})

	gather.say(req.configuration.ivr.text)

	twiml.say('You did not say anything or enter any digits.')
	twiml.pause({length: 2})
	twiml.redirect({method: 'GET'}, 'welcome')

	res.send(twiml.toString())
}

module.exports.welcomeAlt = function (req, res) {
	const twiml =  new twilio.twiml.VoiceResponse()

	const gather = twiml.gather({
		input: 'dtmf speech',
		action: 'translate-text',
		method: 'GET',
		numDigits: 1,
		timeout: 4,
		language: 'en-US'
	})

	gather.say(req.configuration.ivr.text)

	twiml.pause({length: 2})
	twiml.redirect({method: 'GET'}, 'welcome')

	res.send(twiml.toString())
}

var analyzeKeypadInput = function (digits, options) {

	for (let i = 0; i < options.length; i++) {
		if (parseInt(digits) === options[i].digit) {
			return options[i]
		}
	}

	return null
}

var analyzeSpeechInput = function (text, options) {

	for (let i = 0; i < options.length; i++) {
		if (text.toLowerCase().includes(options[i].friendlyName.toLowerCase())) {
			return options[i]
		}
	}

	return null
}

module.exports.selectTeam = function (req, res) {
	let team = null

	/* check if we got a dtmf input or a speech-to-text */
	if (req.query.SpeechResult) {
		console.log('SpeechResult: ' + req.query.SpeechResult)
		team = analyzeSpeechInput(req.query.SpeechResult, req.configuration.ivr.options)
	}

	if (req.query.Digits) {
		team = analyzeKeypadInput(req.query.Digits, req.configuration.ivr.options)
	}

	const twiml =  new twilio.twiml.VoiceResponse()

	/* the caller pressed a key that does not match any team */
	if (team === null) {
		// redirect the call to the previous twiml
		twiml.say('Your selection was not valid, please try again')
		twiml.pause({length: 2})
		twiml.redirect({ method: 'GET' }, 'welcome')
	} else {

		const gather = twiml.gather({
			action: 'create-task?teamId=' + team.id + '&teamFriendlyName=' + encodeURIComponent(team.friendlyName),
			method: 'GET',
			numDigits: 1,
			timeout: 5
		})

		gather.say('Press a key if you want a callback from a ' + team.friendlyName + ' interpreter, or stay on the line')

		/* create task attributes */
		const attributes = {
			text: 'Caller answered IVR with option "' + team.friendlyName + '"',
			channel: 'phone',
			phone: req.query.From,
			name: req.query.From,
			title: 'Inbound call',
			team: team.id
		}

		twiml.enqueue({
			workflowSid: req.configuration.twilio.workflowSid,
		}).task({priority: 1, timeout: 3600}, JSON.stringify(attributes))

	}

	res.send(twiml.toString())
}

module.exports.translateText = function (req, res) {
	/* check if we got a dtmf input or a speech-to-text */

	const twiml =  new twilio.twiml.VoiceResponse()

	let translation = 'Das ist der originale Wert'
	if (req.query.SpeechResult) {
		console.log('SpeechResult: ' + req.query.SpeechResult)

		const postData = JSON.stringify({
			text: req.query.SpeechResult,
			source_lang: 'en-us',
			target_lang: 'de',
			engine: 'deepl'
		})

		const translation_request = http.request({
			hostname: 'localhost',
			port: 8000,
			path: '/api/v1/translate/text',
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
		}, (result) => {
			console.log(`STATUS: ${result.statusCode}`);
			result.setEncoding('utf8')

			result.on('data', (resp) => {
				console.log(`Body: ${resp}`)
				translation = JSON.parse(resp)['translation']
				console.log('in data: ', translation)
			})

			result.on('end', () => {
				console.log('done.')

				twiml.say({
					language: 'de-DE',
					voice: 'Polly.Hans'
				}, translation)

				twiml.redirect({ method: 'GET' }, 'wait-for-new-text')
				res.send(twiml.toString())
			})
		})

		translation_request.on('error', (e) => {
			console.error('ERROR:', e.message)
		})

		translation_request.write(postData)
		translation_request.end()

	} else {
		twiml.redirect({ method: 'GET' }, 'welcome')
	}
}

module.exports.waitForNewText = function (req, res) {
	const twiml =  new twilio.twiml.VoiceResponse()

	twiml.gather({
		input: 'dtmf speech',
		action: 'translate-text',
		method: 'GET',
		numDigits: 1,
		timeout: 4,
		language: 'en-US'
	})

	twiml.pause({length: 2})
	twiml.redirect({method: 'GET'}, 'welcome')

	res.send(twiml.toString())
}

module.exports.createTask = async (req, res) => {
	/* create task attributes */
	const attributes = {
		title: 'Callback request',
		text: 'Caller answered IVR with option "' + req.query.teamFriendlyName + '"',
		channel: 'callback',
		name: req.query.From,
		team: req.query.teamId,
		phone: req.query.From
	}

	const twiml =  new twilio.twiml.VoiceResponse()

	try {
		await taskrouterHelper.createTask(attributes);

		twiml.say('Thanks for your callback request, an agent will call you back soon.')
		twiml.hangup()

		res.status(200).send(twiml.toString());
	} catch (error) {

		twiml.say('An application error occured, the demo ends now')
		res.status(200).send(twiml.toString());
	}

}
