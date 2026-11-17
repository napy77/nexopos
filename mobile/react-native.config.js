// El Bluetooth clásico (SPP) sólo existe en Android: iOS no deja hablarle a
// una térmica clásica que no esté certificada MFi, y enlazar el módulo en iOS
// mete el framework ExternalAccessory, que Apple revisa aparte. En iOS se
// imprime por BLE o por red.
module.exports = {
  dependencies: {
    "react-native-bluetooth-classic": { platforms: { ios: null } },
  },
};
