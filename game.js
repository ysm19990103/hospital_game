// Load resource packages before app/platform creates the game's first visible canvas.
(function () {
  var packages = ['scenes', 'outfits'];
  var started = false;
  var loading = false;
  var attempt = 0;

  function hideLoading() {
    if (typeof wx.hideLoading === 'function') wx.hideLoading();
  }

  function exitGame() {
    if (typeof wx.exitMiniProgram === 'function') wx.exitMiniProgram();
  }

  function loadResources() {
    if (started || loading) return;
    loading = true;
    var currentAttempt = ++attempt;
    var nextPackage = 0;
    if (typeof wx.showLoading === 'function') {
      wx.showLoading({ title: '正在进入医院', mask: true });
    }

    function failed() {
      if (started || !loading || currentAttempt !== attempt) return;
      loading = false;
      hideLoading();
      if (typeof wx.showModal !== 'function') return;
      wx.showModal({
        title: '资源加载失败',
        content: '请检查网络后重试。',
        confirmText: '重试',
        cancelText: '退出',
        success: function (result) {
          if (started || loading || currentAttempt !== attempt) return;
          if (result.confirm) loadResources();
          else if (result.cancel) exitGame();
        }
      });
    }

    function loadNext() {
      var packageIndex = nextPackage;
      function current() {
        return !started && loading && currentAttempt === attempt && packageIndex === nextPackage;
      }
      try {
        wx.loadSubpackage({
          name: packages[packageIndex],
          success: function () {
            if (!current()) return;
            nextPackage++;
            if (nextPackage < packages.length) {
              loadNext();
              return;
            }
            loading = false;
            started = true;
            hideLoading();
            require('./src/app');
          },
          fail: function () { if (current()) failed(); }
        });
      } catch (error) {
        // Do not mistake an application error for a resource download failure.
        if (started) throw error;
        if (current()) failed();
      }
    }
    loadNext();
  }

  if (typeof wx === 'undefined') return;
  if (typeof wx.loadSubpackage !== 'function') {
    if (typeof wx.showModal === 'function') {
      wx.showModal({
        title: '请升级微信',
        content: '当前微信版本不支持资源分包，请升级微信后重新进入。',
        showCancel: false,
        confirmText: '退出',
        success: function (result) { if (result.confirm) exitGame(); }
      });
    }
    return;
  }
  loadResources();
})();
