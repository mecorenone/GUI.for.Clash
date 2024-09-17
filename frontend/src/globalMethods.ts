import { stringify, parse } from 'yaml'

import * as Utils from '@/utils'
import * as Stores from '@/stores'
import * as Bridge from '@/bridge'

/**
 * Expose methods to be used by the plugin system
 */
window.Plugins = {
  ...Bridge,
  ...Utils,
  ...Stores,
  YAML: {
    parse,
    stringify
  },
  BrowserOpenURL: Bridge.Browser.OpenURL,
  ClipboardSetText: Bridge.Clipboard.SetText,
  ClipboardGetText: Bridge.Clipboard.Text,
  WindowReloadApp: Bridge.Window.Reload
}

window.AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
