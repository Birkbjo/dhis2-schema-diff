const yargs = require('yargs');
const path = require('path');
const jsondiffpatch = require('jsondiffpatch');
const fs = require('fs');
const utils = require('./utils');
const ejs = require('ejs');
const got = require('got');

const defaultOpts = {
    absoluteUrl: false,
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
        console.log('Request failed:', e, '\nExiting');
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

async function getSchemasFromFile(file) {
    const content = fs.readFileSync(file);
    return JSON.parse(content);
}

async function getSchemas(url, baseUrl) {
    let schemas;
    // if (utils.isUrl(url)) {
    console.debug('Getting server-info for ', baseUrl, url);
    const reqObj = { baseUrl };
    const schemasUrl = url.concat(defaultOpts.schemasEndpoint);
    const infoUrl = url.concat(defaultOpts.infoEndpoint);
    console.log(schemasUrl, infoUrl);
    const info = await simpleJsonReq(infoUrl, reqObj);
    console.info(
        `Downloading schemas for ${url}. Version: ${info.version} rev: ${
            info.revision
        }`
    );
    schemas = await simpleJsonReq(schemasUrl, reqObj);
    const fileName = schemaIdentifier(info);

    writeSchemasToFile(fileName, schemas, info);
    //  } else {
    //    console.log("Loading from file", url)
    //  schemas = getSchemasFromFile(url);
    //  }
    //  console.log(schemas)
    return schemas;
}

function diff(schemas1, schemas2, output, visuals = false) {
    const delta = Differ.diff(schemas1.schemas, schemas2.schemas);
    visuals && generateVisuals(visuals, schemas1, schemas2, delta);
    if (output) {
        fs.writeFile(output, JSON.stringify(delta), err => {
            if (err) throw err;
        });
    }
    return delta;
}

function generateHtml(left, delta) {
    const template = fs
        .readFileSync(path.join(__dirname, 'index.ejs'))
        .toString();
    return ejs.render(template, {
        left,
        delta,
    });
}

function generateVisuals(fileName, left, right, delta) {
    console.info('Generating visuals...');
    const html = generateHtml(left, delta);
    if (fileName === 'generated.html') {
        fileName = `${schemaDiffIdentifier(left.meta, right.meta)}.html`;
    }
    fs.writeFile(fileName, html, err => {
        if (err) throw err;
        console.log('Visual output written: ', fileName);
    });
}
async function start({ url1, url2, baseUrl, absoluteUrl, output, generate }) {
    const prom1 = getSchemas(url1, baseUrl, absoluteUrl);
    const prom2 = getSchemas(url2, baseUrl, absoluteUrl);
    const [schemasObj1, schemasObj2] = await Promise.all([prom1, prom2]);
    diff(schemasObj1, schemasObj2, output, generate);
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
                // nargs: 1,
                //  default: defaultRequestOpts.baseUrl,
                coerce: val =>
                    val || (val === '' && defaultRequestOpts.baseUrl),
                describe:
                    'BaseUrl to use for downloading schemas. If this is set url1 and url2 should be relative to this url, eg. /dev.',
                type: 'string',
            });
            yargs.option('absolute-url', {
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
                coerce: val => val || (val === '' && 'generated.html'), // This handles as a default if just the flag is given
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
