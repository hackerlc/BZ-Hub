// AI outpainting preserves the center ~74.4% of the frame. Map new UVs back
// to the original composition so the river mask does not drift onto the banks.
window.BZ_HUB_SOURCE_WINDOWS = {
  dawn: [-0.172, 0, 1.344, 1], day: [-0.172, 0, 1.344, 1],
  dusk: [-0.172, 0, 1.344, 1], night: [-0.172, 0, 1.344, 1],
  fog: [-0.172, 0, 1.344, 1], rain: [-0.172, 0, 1.344, 1],
  snow: [-0.172, 0, 1.344, 1],
};
