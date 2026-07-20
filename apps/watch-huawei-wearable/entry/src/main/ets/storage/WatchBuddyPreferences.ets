import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';

import { isCharacterState, isValidDeviceId } from '../network/ApiModels';

const PREFERENCES_NAME: string = 'watchbuddy';
const DEVICE_ID_KEY: string = 'device_id';
const REGISTRATION_KEY: string = 'registration_idempotency_key';
const CHARACTER_STATE_KEY: string = 'character_state';

export class LocalIdentity {
  deviceId: string;
  registrationKey: string;
  characterState: string;

  constructor(deviceId: string, registrationKey: string, characterState: string) {
    this.deviceId = deviceId;
    this.registrationKey = registrationKey;
    this.characterState = characterState;
  }
}

export class WatchBuddyPreferences {
  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async loadIdentity(): Promise<LocalIdentity> {
    try {
      const store: preferences.Preferences =
        await preferences.getPreferences(this.context, PREFERENCES_NAME);
      const storedDeviceId: preferences.ValueType =
        await store.get(DEVICE_ID_KEY, '');
      const storedRegistrationKey: preferences.ValueType =
        await store.get(REGISTRATION_KEY, '');
      const storedState: preferences.ValueType =
        await store.get(CHARACTER_STATE_KEY, 'idle');
      let deviceId: string = typeof storedDeviceId === 'string'
        ? storedDeviceId
        : '';
      if (!isValidDeviceId(deviceId)) {
        deviceId = `gt6pro-${util.generateRandomUUID(true).replaceAll('-', '')}`;
        await store.put(DEVICE_ID_KEY, deviceId);
        await store.flush();
      }
      const registrationKey: string =
        typeof storedRegistrationKey === 'string'
          ? storedRegistrationKey
          : '';
      const characterState: string = typeof storedState === 'string'
        && isCharacterState(storedState)
        ? storedState
        : 'idle';
      return new LocalIdentity(deviceId, registrationKey, characterState);
    } catch (error) {
      throw new Error('preferences_read_failed');
    }
  }

  async saveRegistrationKey(value: string): Promise<void> {
    await this.saveString(REGISTRATION_KEY, value);
  }

  async saveCharacterState(value: string): Promise<void> {
    if (!isCharacterState(value)) {
      throw new Error('invalid_character_state');
    }
    await this.saveString(CHARACTER_STATE_KEY, value);
  }

  private async saveString(key: string, value: string): Promise<void> {
    try {
      const store: preferences.Preferences =
        await preferences.getPreferences(this.context, PREFERENCES_NAME);
      await store.put(key, value);
      await store.flush();
    } catch (error) {
      throw new Error('preferences_write_failed');
    }
  }
}
