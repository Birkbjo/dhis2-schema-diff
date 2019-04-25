const yargs = require('yargs');

const Differ = require('jsondiffpatch').create({
    objectHash: obj => obj.name || obj.type,
    propertyFilter: name => name !== 'href' && name !== 'apiEndpoint',
});
const request = require('request');
const fs = require('fs');
const utils = require('./utils');

const defaultOpts = {
    absoluteUrl: false,
    schemasEndpoint: '/api/schemas.json',
    infoEndpoint: '/api/system/info.json',
    cacheLocation: 'cache',
    noCache: false,
};

const defaultRequestOpts = {
    baseUrl: 'https://play.dhis2.org',
    auth: {
        user: 'admin',
        pass: 'district',
    },
    headers: {
        'x-requested-with': 'XMLHttpRequest',
    },
};

function simpleJsonReq(opts, r = request) {
    const reqOpts = { ...defaultRequestOpts, ...opts };
    return new Promise((resolve, reject) =>
        r.get(reqOpts, (err, response, body) => {
            if (err) {
                reject(err);
            }
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                console.log('Failed to parse', body);
                reject(e);
            }
        })
    );
}

async function writeSchemasToFile(fileName, schemas, meta) {
    if (!meta) {
        throw new Error('Should have metadata before writing');
    }
    fs.mkdirSync(defaultOpts.cacheLocation, { recursive: true });
    const stream = fs.createWriteStream(
        `./${defaultOpts.cacheLocation}/${fileName}.json`
    );

    schemas.meta = meta;
    stream.write(JSON.stringify(schemas));
    return schemas;
}

async function getSchemasFromFile(file) {
    const content = fs.readFileSync(file);
    return JSON.parse(content);
}

async function getSchemas(url, baseUrl, useAbsoluteUrl) {
    if (useAbsoluteUrl) {
        baseUrl = null;
    }
    let schemas;
    // if (utils.isUrl(url)) {
    console.debug('Getting server-info for ', baseUrl, url);
    const schemasUrl = useAbsoluteUrl
        ? url
        : `${url}${defaultOpts.schemasEndpoint}`;
    const info = await simpleJsonReq({
        url: `${url}${defaultOpts.infoEndpoint}`,
        baseUrl,
    });
    console.info(
        `Downloading schemas for ${url}. Version: ${info.version} rev: ${
            info.revision
        }`
    );
    schemas = await simpleJsonReq({ url: schemasUrl, baseUrl });
    const fileName = `${info.version}_${info.revision}`;

    writeSchemasToFile(fileName, schemas, info);
    //  } else {
    //    console.log("Loading from file", url)
    //  schemas = getSchemasFromFile(url);
    //  }
    //  console.log(schemas)
    return schemas;
}

function diff(schemas1, schemas2, output, visuals = false) {
    const delta = Differ.diff(schemas1, schemas2);
    visuals && generateVisuals(visuals, delta, schemas1);
    if (output) {
        fs.writeFile(output, JSON.stringify(delta), err => {
            if (err) throw err;
        });
    }
    return delta;
}

function generateVisuals(fileName, delta, left) {
    console.info('Generating visuals...');
    fs.writeFile(
        fileName,
        `var left = ${JSON.stringify(left)}; var delta = ${JSON.stringify(
            delta
        )}`,
        err => {
            if (err) throw err;
            console.log('Done!');
        }
    );
}
async function start({
    url1,
    url2,
    baseUrl,
    absoluteUrl,
    output,
    generate,
}) {
    const schemas1 = await getSchemas(url1, baseUrl, absoluteUrl);
    const schemas2 = await getSchemas(url2, baseUrl, absoluteUrl);

    diff(schemas1.schemas, schemas2.schemas, output, generate);
}

yargs
    .scriptName('DHIS2-schema-differ')
    .usage('$0 <cmd> [args]')
    .command(
        'start [url1] [url2]',
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
                default: defaultRequestOpts.baseUrl,
                describe:
                    'BaseUrl to use for downloading schemas. If this is set url1 and url2 should be relative to this url, eg. /dev.',
                type: 'string',
            });
            yargs.option('absoluteUrl', {
                default: defaultOpts.absoluteUrl,
                describe:
                    'Specifies that the urls are absolute, indicating that urls are pointing at the schemas.json resource directly. Ignores base-url, and default schema-location (/api/schemas.json)',
                type: 'boolean',
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
                coerce: val => val || (val === '' && 'generated.js'),
                describe:
                    'Path to write a file that can be used to show visual diff using jsondiffpatcher ',
            });
        },
        async function(argv) {
            console.log(argv.url1);
            start(argv);
            console.log(argv);
        }
    )
    .recommendCommands()
    .help().argv;
