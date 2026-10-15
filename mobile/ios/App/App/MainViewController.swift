import UIKit
import WebKit
import Capacitor

/// App 的主视图控制器（Main.storyboard 中使用）。
/// 关闭 WebView 的元素全屏：播放器（ArtPlayer）检测到不支持元素全屏时，会改用 iOS 原生的视频全屏播放器，
/// 避免系统在网页元素全屏时显示「<网址> is in full screen」的提示。
class MainViewController: CAPBridgeViewController {
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        if #available(iOS 15.4, *) {
            configuration.preferences.isElementFullscreenEnabled = false
        }
        return configuration
    }
}
