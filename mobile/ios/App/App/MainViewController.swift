import UIKit
import WebKit
import Capacitor

/// App 的主视图控制器（SceneDelegate 中创建）。
class MainViewController: CAPBridgeViewController {
    /// 播放器已锁定：系统边缘手势（如上滑回桌面）需要连续划两次才生效，防止误触退出 App。
    /// 全屏时隐藏状态栏和 Home 条由 Capacitor 的 SystemBars 插件负责。
    private var playerLocked = false

    /// 关闭 WebView 的元素全屏，避免系统显示「<网址> is in full screen」的提示；
    /// 播放器的全屏由页面自己实现（网页内全屏 + 横屏 + 隐藏系统栏）。
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        if #available(iOS 15.4, *) {
            configuration.preferences.isElementFullscreenEnabled = false
        }
        return configuration
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScreenLockPlugin())
    }

    func setPlayerLocked(_ locked: Bool) {
        playerLocked = locked
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
    }

    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        playerLocked ? .all : []
    }
}

/// 页面通过 Capacitor.Plugins.ScreenLock.setLocked({ locked }) 同步播放器锁定状态
@objc(ScreenLockPlugin)
class ScreenLockPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ScreenLockPlugin"
    let jsName = "ScreenLock"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setLocked", returnType: CAPPluginReturnPromise)
    ]

    @objc func setLocked(_ call: CAPPluginCall) {
        let locked = call.getBool("locked") ?? false
        DispatchQueue.main.async {
            (self.bridge?.viewController as? MainViewController)?.setPlayerLocked(locked)
            call.resolve()
        }
    }
}
