export const NATIVE_DIALOG_STATE_EVENT = "bz-hub-native-dialog-state";

export function setNativeDialogOpen(open: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(NATIVE_DIALOG_STATE_EVENT, { detail: open }));
}
