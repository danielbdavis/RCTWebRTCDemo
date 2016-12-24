var querystring = require ('querystring');
// var fs = require('fs');

var VL, request;

// // hide this import from node (box-ui-shell). fix: make this nicer
// try {
//   VL = require ('./VidLib');
//   request = require('browser-request');
// } catch (e) {}

exports.getHostname = getHostname;
exports.localDevP = localDevP;
exports.isProduction = isProduction;

exports.generateUUID = generateUUID;
exports.cookieSessionID = cookieSessionID;

exports.getNewMeetingURL = getNewMeetingURL;
exports.getMeetingURL = getMeetingURL;

exports.browserChromeOnDesktop_p = browserChromeOnDesktop_p;
exports.browserMobile_p = browserMobile_p;
exports.screenCapStartInnerHTML = screenCapStartInnerHTML;
exports.setupExtensionForScreenCap = setupExtensionForScreenCap;

exports.uiShell_getMainBundleURL = uiShell_getMainBundleURL;
exports.uiShell_getShellURLBase = uiShell_getShellURLBase;
exports.uiShell_getCallURLBase = uiShell_getCallURLBase;
exports.getCtrlURLBase = getCtrlURLBase;

exports.getTwilioConfTokenURL = getTwilioConfTokenURL;
exports.getTwilioConfToken = getTwilioConfToken;

exports.getDialOutURL = getDialOutURL;
exports.getHangUpURL = getHangUpURL;

exports.getFirebaseConfig = getFirebaseConfig;

exports.processArgs = processArgs;
exports.slackUserData = slackUserData;

exports.runningInNode_p = runningInNode_p;
exports.setGlobal       = setGlobal;
exports.readGlobal      = readGlobal;

exports.delayedResolve = delayedResolve;
exports.delayedReject = delayedReject;

exports.MAX_FULL_MEETING_PARTICIPANTS = 6;
exports.MAX_SCREEN_STREAMS = 2;

exports.PEERS_BEFORE_DOWNGRADE_VIDEO_640 = 1;
exports.PEERS_BEFORE_DOWNGRADE_VIDEO_320 = 3;
exports.getBrowserName = getBrowserName;
exports.isIOS = isIOS;

var isBoxWithStaging = null;

function getHostname () {
  if (process.env.PLUOT_LOCAL_DEV) {
    return process.env.PLUOT_LOCAL_DEV;
  } else {
    if (typeof window !== 'undefined') {
      if (window.location && window.location.origin) {
        return window.location.origin;
      }
    // } else if (fs) {
    //   if (isBoxWithStaging === null) {
    //     try {
    //       if (fs.lstatSync('/boot/STAGING').isFile) {
    //         isBoxWithStaging = true;
    //       } else {
    //         isBoxWithStaging = false;
    //       }
    //     } catch (e) {
    //       isBoxWithStaging = false;
    //     }
    //   }

    //   if (isBoxWithStaging) {
    //     return 'https://staging.meet.pluot.co';
    //   }
    }
  }
  return 'https://meet.pluot.co';
}

function localDevP() {
  if (process.env.PLUOT_LOCAL_DEV) {
    return true;
  } else {
    const origin = getHostname();
    if (origin.match(/^https?:\/\/localhost/) ||
        origin.match(/^https?:\/\/(127|192|10)\./)) {
      return true;
    }
  }
  return false;
}

function isProduction() {
  return (getHostname() === 'https://meet.pluot.co');
}

// rfc4122-compliant uuids
//   from: http://stackoverflow.com/questions/105034/
//         how-to-create-a-guid-uuid-in-javascript
//
// fix: we should possibly switch over to using
//      https://github.com/broofa/node-uuid
//
function generateUUID (){
    var d = new Date().getTime();
    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.
    replace(/[xy]/g, function(c) {
        var r = (d + Math.random()*16)%16 | 0;
        d = Math.floor(d/16);
        return (c=='x' ? r : (r&0x7|0x8)).toString(16);
    });
    return uuid;
}

//

function generateMtgStr() {
  const str = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXZ';
  for (let i = 0; i < 12; i++) {
    str[i] = chars.substr(Math.floor(Math.random() * chars.length), 1);
  }
  return str.join('');
}

function getNewMeetingURL() {
  return getMeetingURL(generateMtgStr());
}

function getMeetingURL (mtg_str) {
  return `${getHostname()}/a?m_=${mtg_str}`;
}

function uiShell_getMainBundleURL () {
  return `${getHostname()}/${PLUOT_FIRMWARE}/static/main-bundle.js`;
}

function uiShell_getShellURLBase () {
  return `${getHostname()}/${PLUOT_FIRMWARE}/ui-shell.html`;
}

function uiShell_getCallURLBase () {
  return `${getHostname()}/${PLUOT_FIRMWARE}/call-machine.html`;
}

function getCtrlURLBase () {
  return `${getHostname()}/${PLUOT_FIRMWARE}/ctrl.html`;
}

function getTwilioConfToken (timeout) {
  return new Promise (function (resolve, reject) {
    // request (getTwilioConfTokenURL (timeout), function(err, res) {
    //   if (err) {
    //     reject (err);
    //   }
    //   var tok;
    //   try {
    //     tok = JSON.parse (res.body).token;
    //   } catch (e) {
    //     reject (e);
    //   }
    //   resolve (tok);
    // });
  });
}

function getTwilioConfTokenURL (timeout) {
  return "https://pluot-blue.herokuapp.com/tcct-150721/" +
           timeout + "/tcct-150721.json";
}

function getDialOutURL (mtg_str, num) {
  return "https://pluot-blue.herokuapp.com/" +
           "dial-out/" + mtg_str + "/" + num;
}

function getHangUpURL (mtg_str, twilio_sid) {
  return "https://pluot-blue.herokuapp.com/" +
           "hangup/" + mtg_str + "/" + twilio_sid;
}

// big string with a bunch of stuff embedded:
//  - magic inline install chrome api call
//  - post-install update (pause to allow extension to load, then send
//    the inject request message to the extension)
//  - pre-install HTML content ("install screen sharing extension")
//  - post-install HTML content ("start sharing screen")
//
function screenCapStartInnerHTML () {
  return '<span class="pluot-capture-start"><a onclick="chrome.webstore.install(\'https://chrome.google.com/webstore/detail/hmdgndfhnhnajmclgdaajaiiedefliob\',function(){console.log(\'installation ok, sending inject-updated-content msg\');window.setTimeout(function(){window.postMessage ({ what:\'pluot-screen-share-extension-inject\'},\'*\');console.log(\'msg posted\');},1000)}, function(err){console.log(\'installation failed\',err);})"><i class="fa fa-download fa-fw"></i>&nbsp;&nbsp;download screen sharing extension</a><span class="start-text"><i class="fa fa-desktop fa-fw"></i>&nbsp;&nbsp;share your screen</span></span>'
}

//  return '<p class="pluot-capture-start"><a onclick="chrome.webstore.install(\'https://chrome.google.com/webstore/detail/hmdgndfhnhnajmclgdaajaiiedefliob\',function(){console.log(\'installation ok, sending inject-updated-content msg\');window.setTimeout(function(){window.postMessage ({ what:\'pluot-screen-share-extension-inject\'},\'*\');console.log(\'msg posted\');},1000)}, function(err){console.log(\'installation failed\',err);})">install screen sharing extension</a><span class="start-text">start sharing screen</span></p>'

function setupExtensionForScreenCap (ui_container, ksuccess) {
  var el = ui_container;
  if (! ui_container.innerHTML) {
    el = document.getElementById(ui_container);
  }
  el.innerHTML = screenCapStartInnerHTML ();
  window.postMessage ({ what: 'pluot-screen-share-extension-inject' },"*");

  // window.addEventListener('message', function (evt) {
  //   // console.log ('front-end-page message', evt);
  //   if (evt.data.what === 'start-chrome-screen-capture') {
  //     VL.getScreenStream (
  //       evt.data.id,
  //       // success
  //       ksuccess,
  //       // error
  //       function (err) {
  //         console.log ('get-user-media failure', err);
  //       });
  //   }

  // });
}

function processArgs (arg_str) {
  // strip zero width space, which google calendar inserts in the
  // "Where" portion of a calendar event.
  arg_str = arg_str.replace(/%E2%80%8B/g, '');
  var args = querystring.parse (arg_str);
  var match, qargs;

  //
  // some special args processing -- this is mostly historical and we
  // might want to change this code at some point.
  //
  if ((match = arg_str.match (/m_=([^&]+)/))) {
    args.mtg_str = match[1];
  }
  if ((match = arg_str.match (/sc_=([^&]+)/))) {
    args.screen_code = match[1];
  }
  if ((match = arg_str.match (/layout=([^&]+)/))) {
    args.layout = match[1];
  }
  if ((match = arg_str.match (/[?&]id=([^&]+)/))) {
    args.session_id = match[1];
  } else if (arg_str.match (/use-temp-session-id=true/)) {
    args.use_temp_session_id = true;
  }
  if ((arg_str.match (/[\/&]delay_cam/))) {
    args.delay_local_gum = true;
  }
  if ((match = arg_str.match (/ipc=ashell/))) {
    args.ipc_control = 'ashell';
  }

  return args;
}

function browserChromeOnDesktop_p () {
  if (navigator.userAgent.match(/Chrome\//) &&
      ! browserMobile_p ()) {
    return true;
  }
  return false;
}

function browserMobile_p () {
  if (navigator.userAgent.match(/Mobi/) ||
        navigator.userAgent.match(/Android/)) {
    return true;
  }
}

function isIOS() {
  if (typeof window !== 'undefined') {
    const userAgent = window.navigator.userAgent;
    return (
      !!userAgent.match(/iPad/i) ||
      !!userAgent.match(/iPhone/i)
    );
  }
}

function cookieSessionID () {
  var re = /session-id=(.{8}-.{4}-.{4}-.{4}-.{12})/;
  var cook = document.cookie;
  var session_id;

  if (cook.length > 0) {
    var match = re.exec (cook);
    if (match) {
      return match[1];
      if (mixpanel && mixpanel.register) {
        mixpanel.register({'Pluot Session ID': match[1]});
      }
    }
  }

  // okay, so we need to create a new session ID and set the cookie
  session_id = generateUUID ();
  document.cookie = 'session-id=' + session_id +
    '; expires=Tue, 19 Jan 2038 03:14:07 GMT;path=/' +
    (localDevP() ? '' : ';domain=pluot.co');
  return session_id;
}

function runningInNode_p () {
  return (typeof (process) !== 'undefined'  &&  process.version);
}

function setGlobal (name, value) {
  var g = runningInNode_p () ? global : window;
  g[name] = value;
}

function readGlobal (name) {
  var g = runningInNode_p () ? global : window;
  return g[name];
}

function slackUserData (config, localStorage) {
  var user_data = {};
  // pull user data hash out of localStorage, if we've got any
  if (localStorage.slack_user_data) {
    user_data = JSON.parse (localStorage.slack_user_data);
  }
  console.log ("ud", user_data);
  // update user data hash from config.st, and stringify and
  // save it to local storage
  if (config.st) {
    user_data[config.st] = config.su;
    localStorage.slack_user_data = JSON.stringify (user_data);
  }
  // if we have any slack user data, squirrel it away in our
  // config object
  if (Object.keys(user_data).length) {
    config.slack_user_data = user_data;
  }
}

function getFirebaseConfig() {
  if (isProduction()) {
    return {
      apiKey: "AIzaSyDqq8kmOok-rj5ohUVOm6XxhPAWRaDCgWw",
      authDomain: "blazing-inferno-1599.firebaseapp.com",
      databaseURL: "https://blazing-inferno-1599.firebaseio.com",
      storageBucket: "blazing-inferno-1599.appspot.com",
      messagingSenderId: "409334417986"
    };
  } else {
    return {
      apiKey: "AIzaSyCkV_iCyr1vNyu5kRIrv10Tf8szNW_t7nM",
      authDomain: "pluot-staging.firebaseapp.com",
      databaseURL: "https://pluot-staging.firebaseio.com",
      storageBucket: "pluot-staging.appspot.com",
      messagingSenderId: "991439070856",
    };
  }
}

// delayedReject - returns a promise that resolves after 'seconds'
//
function delayedReject (seconds) {
  return new Promise(function (x, r) {setTimeout(r, seconds*1000);});
};

// delayedResolve - returns a promise that resolves after 'seconds'
//
function delayedResolve (seconds) {
  return new Promise(function (r, x) {setTimeout(r, seconds*1000);});
};


function getBrowserName() {
  if (typeof window !== 'undefined') {
    const userAgent = window.navigator.userAgent;
    if (userAgent.match(/Chrome\//)) {
      return 'Chrome';
    } else if (userAgent.indexOf('Safari') > -1) {
      return 'Safari';
    } else if (userAgent.indexOf('Opera') > -1) {
      return 'Opera';
    } else if (userAgent.indexOf('Firefox') > -1) {
      return 'Firefox';
    } else if (userAgent.indexOf('MSIE') > -1) {
      return 'IE';
    } else {
      return 'Unknown Browser';
    }
  }
}
