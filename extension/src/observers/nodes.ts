/**
 * DOM node kinds the observers read (sprint_2 TECH-14: one definition, not one per observer). The values are
 * `Node.ELEMENT_NODE` and `Node.TEXT_NODE`, spelt out because the `Node` global is not in every runtime the
 * observers run or are tested in. Reading only (Hard Rule 3).
 */

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
/** `Node.DOCUMENT_POSITION_FOLLOWING`: in `a.compareDocumentPosition(b)`, `b` comes after `a` in document order. */
export const DOCUMENT_POSITION_FOLLOWING = 4;

/** True when `node` is an element. */
export function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}
