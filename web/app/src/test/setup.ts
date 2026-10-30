import { useQueue } from '../player/queue'

// jsdom has no layout, so the router's scroll restoration has nothing to do.
window.scrollTo = () => {}

// jsdom has media elements but no media.
window.HTMLMediaElement.prototype.play = () => Promise.resolve()
window.HTMLMediaElement.prototype.load = () => {}

// The queue outlives a render, as it does in the browser.
afterEach(() => useQueue.getState().clear())
