const { app } = require('@azure/functions');
const { getChromiumInfo } = require('../lib/chromium');

async function containerInfo() {
    let chromium;
    try {
        chromium = {
            available: true,
            ...await getChromiumInfo()
        };
    } catch (error) {
        chromium = {
            available: false,
            path: null,
            version: null,
            error: error.message
        };
    }

    return {
        status: 200,
        jsonBody: {
            nodeVersion: process.version,
            platform: process.platform,
            architecture: process.arch,
            chromium
        },
        headers: {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        }
    };
}

app.http('ContainerInfo', {
    route: 'container-info',
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: containerInfo
});

module.exports = { containerInfo };
