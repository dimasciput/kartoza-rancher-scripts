const request = require('request');
const fs = require('fs')

// Get keys from secrets.json
let keysRawData = fs.readFileSync('secrets.json')
let keysJSON = JSON.parse(keysRawData);
let accessKey = keysJSON['rancherAccessKey']
let secretKey = keysJSON['rancherSecretKey']

if (!accessKey || !secretKey) {
	console.log('Missing access/secret key in secrets.json');
	return;
}

// Get commands 
let commandsRawData = fs.readFileSync('commands.json')
let commandsData = JSON.parse(commandsRawData);
let url = commandsData['rancherApiUrl'];
let projectName = commandsData['project'];
let auth = 'Basic ' + new Buffer(accessKey+':'+ secretKey).toString('base64');
let headers = {
	'Authorization' : auth
}
var commands = commandsData['commands'];

console.log('Get Project : ' + projectName);
request(
	{
		url: url + 'projects',
		headers: headers,
		json: true
	}, (err, res, body) => {
 		if (err) { 
 			return console.log(err); 
 		}
 		let data = body['data'];

		// Find project
		for(let i=0; i<data.length; i++) {
			if(data[i]['name'] === projectName) {
				for(let j=0; j<commands.length; j++) {
 					let serviceName = commands[j]['service'];
 					let serviceOptions = commands[j]['options'];
					let serviceAction = commands[j]['action']; 					
 					getServices(data[i], serviceName, serviceOptions, serviceAction);
 				}
			}
		}
	}
);

function getServices(project, serviceName, serviceOptions, serviceAction) {
	console.log('Get Service : ' + serviceName);
	request(
		{
			url: url + 'projects/' + project['id'] + '/services',
			headers: headers,
			json: true
		}, (err, res, body) => {
			if (err) {
				return console.log(err);
			}
			let data = body['data'];
			
			for(let i=0; i<data.length; i++) {
				if(data[i]['name'] === serviceName) {
					processService(project, data[i], serviceAction, serviceOptions);
				}
			}
		}
	)
}

function processService(project, service, action, options) {
	console.log('Process Service : ' + action + ' ' + service['name'] + ' service in ' + project['name']);

	let lc = service.launchConfig;
	let slc = service.secondaryLaunchConfigs;

	let body = {}

	if (action === 'upgrade') {
		lc.labels["io.rancher.container.pull_image"] = "always";

		if ('image' in options) {
			lc.imageUuid = options['image'];
		}

		body = {
	  		inServiceStrategy: {
	    		batchSize: 1,
	    		intervalMillis: 2000,
	    		startFirst: false,
	    		launchConfig: lc, 
	    		secondaryLaunchConfigs: slc 
	  		} 
		}
	} else if (action === 'restart') {
		body = {
			rollingRestartStrategy: {
				batchSize: 1,
				intervalMillis: 2000
			}
		}
	}

	request(
		{
			url: url + 'projects/' + project['id'] + '/services/' + service['id'] + '/?action=' + action,
			headers: headers,
			method: 'POST',
			json: true,
			body: body
		}, (err, res, body) => {
			if (err) {
				return console.log(err);
			}

			if (body['type'] === 'error') {
				console.log('Error : ' + body['code'] + ' ' + service['name']);	
			} else {
				console.log('Success : ' + body['state'] + ' ' + service['name']);
				if (action === 'upgrade') {
					finishUpgrade(project, service);
				}
			}
		}
	)
}

function finishUpgrade(project, service) {
	request(
		{
			url: url + 'projects/' + project['id'] + '/services/' + service['id'],
			headers: headers,
			json: true
		}, (err, res, body) => {
			if (err) {
				return console.log(err);
			}
			let state = body['state'];
			if (state === 'upgrading') {
				console.log('Status : upgrading ' + service['name']);		
				finishUpgrade(project, service);
				return;
			} else {
				console.log('Status : finish upgrading ' + service['name']);
				request(
					{
						url: url + 'projects/' + project['id'] + '/services/' + service['id'] + '/?action=finishupgrade',
						headers: headers,
						json: true,
						method: 'POST'
					}, (err, res, body) => {
				 		if (err) { 
				 			return console.log(err); 
				 		}
					}
				);
			}
		}
	)
}

