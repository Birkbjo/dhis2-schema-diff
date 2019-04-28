#! /usr/bin/env node
const yargs = require('yargs');
const path = require('path');
const jsondiffpatch = require('jsondiffpatch');
const fs = require('fs');
const utils = require('./utils');
const ejs = require('ejs');
const got = require('got');

const defaultOpts = {
    schemasEndpoint: '/api/schemas.json',
    infoEndpoint: '/api/system/info.json',
    cacheLocation: 'cache',
    noCache: false,
};

const defaultRequestOpts = {
    baseUrl: 'https://play.dhis2.org',
    headers: {
        'x-requested-with': 'XMLHttpRequest',
        Authorization: utils.basicAuthHeader('admin', 'district'),
    },
    json: true,
};

const schemaIdentifier = info => `${info.version}_${info.revision}`;
const schemaDiffIdentifier = (info1, info2) =>
    `${schemaIdentifier(info1)}__${schemaIdentifier(info2)}`;

// We use the singular property as an unique identifier for schemas
// type is
const Differ = jsondiffpatch.create({
    objectHash: obj => obj.singular || obj.type,
    propertyFilter: name => name !== 'href' && name !== 'apiEndpoint',
});

async function simpleJsonReq(url, opts) {
    const reqOpts = { ...defaultRequestOpts, ...opts };
    try {
        const res = await got(url, reqOpts);
        //console.log(res)
        return res.body;
    } catch (e) {
        console.log(
            'Request',
            url,
            'failed:',
            e.statusCode,
            e.statusMessage,
            e.toString(),
            '\nExiting'
        );
        yargs.exit();
    }
}

function writeSchemasToFile(fileName, schemas, meta) {
    if (!meta) {
        throw new Error('Should have metadata before writing');
    }
    fs.mkdirSync(defaultOpts.cacheLocation, { recursive: true });
    const fileLocation = `./${defaultOpts.cacheLocation}/${fileName}.json`;
    const stream = fs.createWriteStream(fileLocation);

    schemas.meta = meta;
    stream.write(JSON.stringify(schemas));
    return schemas;
}

function checkFile(file) {
    try {
        const content = fs.readFileSync(file);
        return JSON.parse(content);
    } catch (e) {
        return false;
    }
}

function checkCache(info) {
    const schemaName = schemaIdentifier(info);
    try {
        const content = fs.readFileSync(
            path.join(defaultOpts.cacheLocation, schemaName)
        );
        return JSON.parse(content);
    } catch (e) {
        return false;
    }
}

async function fromServer(url, baseUrl) {
    const schemasUrl = url.concat(defaultOpts.schemasEndpoint);
    const infoUrl = url.concat(defaultOpts.infoEndpoint);
    const reqObj = { baseUrl };
    let schemas;

    const meta = await simpleJsonReq(infoUrl, reqObj);
    if ((schemas = checkCache(meta))) {
        console.log('Cache hit!');
    } else {
        schemas = await simpleJsonReq(schemasUrl, reqObj);
        console.info(
            `Downloading schemas for ${url}. Version: ${info.version} rev: ${
                info.revision
            }`
        );
    }
    return {
        meta,
        schemas,
    };
}

async function getSchemas(urlLike, baseUrl) {
    // if (utils.isUrl(url)) {

    let schemas;
    let fileContents;
    if ((fileContents = checkFile(urlLike))) {
        schemas = fileContents;
    } else {
        schemas = await fromServer(urlLike, baseUrl);
        const fileName = schemaIdentifier(schemas.info);
        writeSchemasToFile(fileName, schemas, info);
    }
    return schemas;
}

function diff(left, right, output, generate = false) {
    const delta = Differ.diff(left.schemas, right.schemas);
    if (generate !== false) {
        generateVisuals(generate, left, right, delta);
    }
    if (output) {
        fs.writeFile(output, JSON.stringify(delta), err => {
            if (err) throw err;
        });
    }
    return delta;
}

function generateHtml(left, delta, meta) {
    const assets = {
        jsondiffpatchCSS: utils.btoa(
            fs.readFileSync(
                path.join(
                    __dirname,
                    '..',
                    'node_modules/jsondiffpatch/dist/formatters-styles/html.css'
                )
            )
        ),
        jsondiffpatchJS: utils.btoa(
            fs.readFileSync(
                path.join(
                    __dirname,
                    '..',
                    'node_modules/jsondiffpatch/dist/jsondiffpatch.umd.slim.js'
                )
            )
        ),
    };

    const template = fs
        .readFileSync(path.join(__dirname, 'index.ejs'))
        .toString();

    return ejs.render(template, {
        left,
        delta,
        meta,
        ...assets,
    });
}

function generateVisuals(fileName, left, right, delta) {
    console.info('Generating visuals...');

    const html = generateHtml(left.schemas, delta, {
        left: left.meta,
        right: right.meta,
    });
    if (fileName === '') {
        fileName = `${schemaDiffIdentifier(left.meta, right.meta)}.html`;
    }
    fs.writeFile(fileName, html, err => {
        if (err) throw err;
        console.log('Visual output written: ', fileName);
    });
}
async function start({ url1, url2, baseUrl, output, generate }) {
    const prom1 = getSchemas(url1, baseUrl);
    const prom2 = getSchemas(url2, baseUrl);
    const [left, right] = await Promise.all([prom1, prom2]);
    return diff(left, right, output, generate);
}

yargs
    .scriptName('DHIS2-schema-differ')
    .usage('$0 <cmd> [args]')
    .command(
        ['start [url1] [url2]', '$0'],
        'welcome ter yargs!',
        yargs => {
            yargs.positional('url1', {
                type: 'string',
                default: '/2.29',
                describe: `the url to the running DHIS2 server, should have schemas available relative to this at ${
                    defaultOpts.schemasEndpoint
                }. Can also be a file-location`,
            });
            yargs.positional('url2', {
                type: 'string',
                default: '/dev',
                describe: `the url to another running DHIS2 server, should have schemas available relative to this at ${
                    defaultOpts.schemasEndpoint
                }. Can also be a file-location`,
            });
            yargs.option('base-url', {
                alias: 'b',
                coerce: val =>
                    val || (val === '' && defaultRequestOpts.baseUrl),
                describe:
                    'BaseUrl to use for downloading schemas. If this is set url1 and url2 should be relative to this url, eg. /dev.',
                type: 'string',
            });
            yargs.option('output', {
                alias: 'o',
                nargs: 1,
                type: 'string',
                describe: 'Write the output of diff to file',
            });
            yargs.option('generate', {
                alias: 'g',
                type: 'string',
                describe:
                    'Path to write a file that can be used to show visual diff using jsondiffpatcher. Can be used as a flag, writing to current working directory with filename LEFT-version_revision__RIGHT-version_revision.html',
            });
        },
        async function(argv) {
            start(argv);
        }
    )
    .check(argv => {
        const { url1, url2 } = argv;

        if (
            !argv.baseUrl &&
            ((utils.isRelativeUrl(argv.url1) && !fs.existsSync(url1)) ||
                (utils.isRelativeUrl(argv.url2) && !fs.existsSync(url1)))
        ) {
            throw new Error(
                'Must specify absolute urls when base-url is not given.'
            );
        }
        return true;
    }, true)
    .recommendCommands()
    .help().argv;
