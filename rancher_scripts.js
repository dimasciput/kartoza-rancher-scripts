const request = require('request');
const fs = require('fs');
let accessKey = '';
let secretKey = '';

// Get keys from environment
if (process.env.rancherAccessKey) {
    accessKey = process.env.rancherAccessKey;
} 
if (process.env.rancherSecretKey) {
    secretKey = process.env.rancherSecretKey;
}

if (!accessKey || !secretKey) {
   // Get keys from secrets.json
   let keysRawData = fs.readFileSync('secrets.json')
   let keysJSON = JSON.parse(keysRawData);
   accessKey = keysJSON['rancherAccessKey']
   secretKey = keysJSON['rancherSecretKey']
}

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
};
var commands = commandsData['commands'];

function getProjects() {
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
	            	var allcommands = [];
	                for(let j=0; j<commands.length; j++) {
	                    allcommands.push({
	                    	'project': data[i],
	                    	'serviceName': commands[j]['service'],
	                    	'serviceOptions': commands[j]['options'],
	                    	'serviceAction': commands[j]['action']
	                    })
	                }
	                processAsyncServices(allcommands);
	            }
	        }
	    }
	)
}

async function processAsyncServices(commands) {
	for(var i=0; i<commands.length; i++) {
        let serviceName = commands[i]['serviceName'];
        let serviceOptions = commands[i]['serviceOptions'];
        let serviceAction = commands[i]['serviceAction'];	
        let project = commands[i]['project'];	
		await getServices(project, serviceName, serviceOptions, serviceAction);
	}
}

function getServices(project, serviceName, serviceOptions, serviceAction) {
    console.log('Get Service : ' + serviceName);
    return new Promise((resolve, reject) => {
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
	                    resolve(processService(project, data[i], serviceAction, serviceOptions));
	                }
	            }
	        }
	    )
	});
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

    return new Promise((resolve, reject) => {
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
	            	resolve(body);
	            } else {
	                console.log('Success : ' + body['state'] + ' ' + service['name']);
	                if (action === 'upgrade') {
	                    resolve(finishUpgrade(project, service));
	                } else {
	                	resolve(body);
	                }
	            }
	        }
	    )
	})
}

function finishUpgrade(project, service) {
	return new Promise((resolve, reject) => {
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
	                setTimeout(() => {
	                	resolve(finishUpgrade(project, service));
	                }, 5000);
	                return;
	            } else {
	            	resolve(body);
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
	});
}

getProjects();
