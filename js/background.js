chrome.browserAction.onClicked.addListener(browserAction);

function browserAction(tab) {
    chrome.tabs.sendMessage(tab.id, {
        type: 'browserAction',
        data: {}
    }, function () {
        // message callback
    });
}