const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

function chromiumCandidates() {
    const candidates = [
        process.env.CHROMIUM_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];

    const windowsRoots = [
        process.env.PROGRAMFILES,
        process.env['PROGRAMFILES(X86)'],
        process.env.LOCALAPPDATA
    ].filter(Boolean);

    for (const root of windowsRoots) {
        candidates.push(
            path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        );
    }

    return [...new Set(candidates.filter(Boolean))];
}

function findChromiumExecutable() {
    for (const candidate of chromiumCandidates()) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        'Chromium was not found. Set CHROMIUM_PATH to a Chrome or Chromium executable.'
    );
}

function launchOptions() {
    return {
        executablePath: findChromiumExecutable(),
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    };
}

async function getChromiumInfo() {
    const options = launchOptions();
    const browser = await puppeteer.launch(options);
    try {
        return {
            path: options.executablePath,
            version: await browser.version()
        };
    } finally {
        await browser.close();
    }
}

async function renderPdf(html) {
    const browser = await puppeteer.launch(launchOptions());
    try {
        const page = await browser.newPage();
        await page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.emulateMediaType('print');

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            tagged: true,
            outline: true,
            margin: {
                top: '10mm',
                right: '10mm',
                bottom: '10mm',
                left: '10mm'
            }
        });

        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}

module.exports = {
    findChromiumExecutable,
    getChromiumInfo,
    renderPdf
};
