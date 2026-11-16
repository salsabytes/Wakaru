let busy = false

export const setAiBusy = (value: boolean): void => {
  busy = value
}

export const isAiBusy = (): boolean => busy
