/* Hand-traced river banks in the original composition coordinates.
 * Shared by the refraction shader and rainfall rings. No bitmap mask is needed. */
(function () {
    var river = [
        [.50, .45], [.41, .50], [.30, .56], [.27, .64], [.20, .73], [.12, .83], [.08, .93], [.10, 1.02],
        [.75, 1.02], [.73, .93], [.77, .83], [.78, .73], [.74, .64], [.70, .56], [.62, .50], [.55, .45]
    ];
    var rocks = [
        [.20, .59, .095, .09], [.74, .88, .055, .10], [.69, .73, .065, .045],
        [.67, .635, .049, .024], [.72, .55, .05, .035], [.57, .485, .04, .018],
        [.47, .47, .024, .012], [.12, .89, .047, .035]
    ];
    var regions = {};
    ['dawn', 'day', 'dusk', 'night', 'fog', 'rain', 'snow'].forEach(function (name) {
        regions[name] = { banks: river.map(function (p) { return p.slice(); }), rocks: rocks.map(function (r) { return r.slice(); }) };
    });
    regions.day.banks[0] = [.49, .435];
    regions.day.banks[15] = [.56, .435];
    regions.day.rocks[2] = [.70, .65, .041, .024];
    regions.dusk.banks[0] = [.48, .405];
    regions.dusk.banks[15] = [.56, .405];
    regions.fog.banks[0] = [.50, .50];
    regions.fog.banks[15] = [.57, .50];
    regions.fog.rocks[2] = [.69, .78, .07, .04];
    regions.snow.banks[0] = [.49, .50];
    regions.snow.banks[15] = [.57, .50];
    regions.snow.banks[4] = [.21, .73];
    regions.snow.banks[5] = [.11, .83];
    regions.snow.rocks[2] = [.72, .78, .09, .085];
    regions.snow.rocks[3] = [.62, .648, .032, .017];
    function contains(name, x, y) {
        var region = regions[name], inside = false, points = region.banks;
        for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
            var a = points[i], b = points[j];
            if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])
                inside = !inside;
        }
        return inside && !region.rocks.some(function (r) {
            return Math.pow((x - r[0]) / r[2], 2) + Math.pow((y - r[1]) / r[3], 2) < 1.15;
        });
    }
    window.BZWaterRegions = { scenes: regions, contains: contains };
})();
