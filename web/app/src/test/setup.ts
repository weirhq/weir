import { configure } from '@testing-library/react'
import { useQueue } from '../player/queue'

// A busy CI runner can take over the default second to render a page.
configure({ asyncUtilTimeout: 5000 })

// jsdom has no layout, so the router's scroll restoration has nothing to do.
window.scrollTo = () => {}

// Radix's menus and selects use browser APIs jsdom lacks.
Element.prototype.scrollIntoView = () => {}
Element.prototype.hasPointerCapture = () => false
Element.prototype.releasePointerCapture = () => {}

// jsdom has no media queries; tests see a wide window, with the rail.
window.matchMedia ??= (query: string) =>
  ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {}
  }) as unknown as MediaQueryList

// The tabs' indicator follows sizes, which jsdom doesn't have.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom has media elements but no media.
window.HTMLMediaElement.prototype.play = () => Promise.resolve()
window.HTMLMediaElement.prototype.load = () => {}

// The queue outlives a render, as it does in the browser.
afterEach(() => useQueue.getState().clear())
