import type { ElementPosition } from "./uiPersistence.js";

export function setStyle(element: HTMLElement, property: string, value: string): void {
  const cssProperty = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
  if (element.style.getPropertyValue(cssProperty) !== value) {
    element.style.setProperty(cssProperty, value);
  }
}

export function elementPosition(element: HTMLElement): ElementPosition {
  const position: ElementPosition = {};
  if (element.style.left) {
    position.left = element.style.left;
  }
  if (element.style.top) {
    position.top = element.style.top;
  }
  if (element.style.right) {
    position.right = element.style.right;
  }
  if (element.style.bottom) {
    position.bottom = element.style.bottom;
  }
  if (element.style.transform) {
    position.transform = element.style.transform;
  }
  return position;
}

export function applyPosition(element: HTMLElement, position: ElementPosition | undefined): void {
  if (!position) {
    return;
  }
  setStyle(element, "left", position.left ?? "");
  setStyle(element, "top", position.top ?? "");
  setStyle(element, "right", position.right ?? "");
  setStyle(element, "bottom", position.bottom ?? "");
  setStyle(element, "transform", position.transform ?? "");
}

export function resetPosition(element: HTMLElement): void {
  setStyle(element, "left", "");
  setStyle(element, "top", "");
  setStyle(element, "right", "");
  setStyle(element, "bottom", "");
  setStyle(element, "transform", "");
}
