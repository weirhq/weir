// jsdom has no layout, so the router's scroll restoration has nothing to do.
window.scrollTo = () => {}

// jsdom has media elements but no media.
window.HTMLMediaElement.prototype.play = () => Promise.resolve()
window.HTMLMediaElement.prototype.load = () => {}
