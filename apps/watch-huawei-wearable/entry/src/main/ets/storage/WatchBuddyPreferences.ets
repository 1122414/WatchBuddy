import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';

import { isCharacterState, isValidDeviceId } from '../network/ApiModels';
import {
  isValidPetId,
  isValidPetVersion
} from '../network/ApiModels';

const PREFERENCES_NAME: string = 'watchbuddy';
const DEVICE_ID_KEY: string = 'device_id';
const REGISTRATION_KEY: string = 'registration_idempotency_key';
const CHARACTER_STATE_KEY: string = 'character_state';
const PET_SELECTION_KEY: string = 'pet_selection';

interface PetSelectionPayload {
  petId: string;
  version: string;
}

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

export class PetSelection {
  petId: string;
  version: string;

  constructor(petId: string, version: string) {
    this.petId = petId;
    this.version = version;
  }

  isDownloaded(): boolean {
    return isValidPetId(this.petId) && isValidPetVersion(this.version);
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

  async loadPetSelection(): Promise<PetSelection> {
    try {
      const store: preferences.Preferences =
        await preferences.getPreferences(this.context, PREFERENCES_NAME);
      const storedSelection: preferences.ValueType =
        await store.get(PET_SELECTION_KEY, '');
      if (typeof storedSelection !== 'string'
        || storedSelection.length < 1
        || storedSelection.length > 160) {
        return new PetSelection('', '');
      }
      const payload: PetSelectionPayload =
        JSON.parse(storedSelection) as PetSelectionPayload;
      if (!payload
        || !isValidPetId(payload.petId)
        || !isValidPetVersion(payload.version)) {
        return new PetSelection('', '');
      }
      return new PetSelection(payload.petId, payload.version);
    } catch (error) {
      return new PetSelection('', '');
    }
  }

  async savePetSelection(selection: PetSelection): Promise<void> {
    if (!selection.isDownloaded()) {
      throw new Error('invalid_pet_selection');
    }
    const payload: PetSelectionPayload = {
      petId: selection.petId,
      version: selection.version
    };
    await this.saveString(PET_SELECTION_KEY, JSON.stringify(payload));
  }

  async clearPetSelection(): Promise<void> {
    await this.saveString(PET_SELECTION_KEY, '');
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
