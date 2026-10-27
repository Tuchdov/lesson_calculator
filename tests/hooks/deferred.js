/**
 * Create a promise whose completion can be controlled by a test.
 * @returns {{promise: Promise, resolve: Function, reject: Function}} The promise and its settlement functions.
 */
export function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
