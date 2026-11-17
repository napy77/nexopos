// Xcode 27 no compila targets con un mínimo de iOS menor a 15. Algunos pods
// todavía declaran uno viejo en el paquete de recursos (SDWebImage, que entra
// por expo-image, sale con 9.0). Se sube sólo el de los que están por debajo.
//
// Va como plugin porque `ios/` se genera con `expo prebuild` y no se versiona:
// un arreglo a mano en el Podfile se perdería en la próxima compilación.
const { withPodfile } = require("expo/config-plugins");

const MARCA = "# nexopos: mínimo de iOS de los pods";
const MINIMO = "15.1";

module.exports = function withPodsDeploymentTarget(config) {
  return withPodfile(config, (cfg) => {
    let podfile = cfg.modResults.contents;
    if (podfile.includes(MARCA)) return cfg;
    podfile = podfile.replace(
      /post_install do \|installer\|\n/,
      `post_install do |installer|
    ${MARCA}
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |bc|
        actual = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if actual.nil? || Gem::Version.new(actual) < Gem::Version.new('${MINIMO}')
          bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MINIMO}'
        end
      end
    end
`
    );
    cfg.modResults.contents = podfile;
    return cfg;
  });
};
