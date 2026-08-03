/**
 * Connector contract reference (runtime-agnostic):
 *
 * id: string
 * status(ctx) -> { connected:boolean, details?:object }
 * list(ctx, params) -> { items: any[] }
 * pull(ctx, params) -> { item?:any, content?:any }
 * act(ctx, params) -> { ok:boolean, message?:string }
 * disconnect(ctx) -> { ok:boolean }
 */

function notImplemented(name) {
  return async function notImplementedHandler() {
    const err = new Error(`${name} not implemented`);
    err.code = 'NOT_IMPLEMENTED';
    throw err;
  };
}

module.exports = {
  notImplemented,
};
