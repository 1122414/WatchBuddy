import file from '@system.file';

export const watchPetFiles = {
  move(sourceUri, destinationUri, onSuccess, onFailure) {
    file.move({
      dstUri: destinationUri,
      fail: onFailure,
      srcUri: sourceUri,
      success: onSuccess
    });
  },

  readBuffer(uri, onSuccess, onFailure) {
    file.readArrayBuffer({
      fail: onFailure,
      success(data) {
        onSuccess(data.buffer);
      },
      uri
    });
  },

  readText(uri, onSuccess, onFailure) {
    file.readText({
      encoding: 'UTF-8',
      fail: onFailure,
      success(data) {
        onSuccess(data.text);
      },
      uri
    });
  },

  remove(uri, onComplete) {
    file.delete({
      fail() {
        onComplete(false);
      },
      success() {
        onComplete(true);
      },
      uri
    });
  },

  writeBuffer(uri, buffer, onSuccess, onFailure) {
    file.writeArrayBuffer({
      append: false,
      buffer,
      fail: onFailure,
      position: 0,
      success: onSuccess,
      uri
    });
  },

  writeText(uri, text, onSuccess, onFailure) {
    file.writeText({
      append: false,
      encoding: 'UTF-8',
      fail: onFailure,
      success: onSuccess,
      text,
      uri
    });
  }
};
