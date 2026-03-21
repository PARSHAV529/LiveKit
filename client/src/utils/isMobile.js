
export function isMobile() {
  const hasTouch = navigator.maxTouchPoints > 1;
  const smallScreen = window.screen.width <= 1024;
  return hasTouch && smallScreen;
}
