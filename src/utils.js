const URL = require("url").URL;

function isUrl(url) {
    try {
        new URL(url);
        return true;
    } catch(e) { 
        return false;
    }
}


module.exports = {
    isUrl,

}