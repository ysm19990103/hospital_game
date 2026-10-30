'use strict';
// HTTPS base for WeChat media. Keep chXX.mp4 and side/*.mp4 below the same base.
// Browser index uses media/ paths; the standalone HTML embeds every video in the current chapter and side-story catalogs.
// Configure the WeChat media domain before release. Never put credentials here.
module.exports={baseUrl:'',localFolder:'media/',enableNativeVideo:true};
