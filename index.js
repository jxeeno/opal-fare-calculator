const jKstra = require('jkstra');
const graph = new jKstra.Graph();
const _ = require('lodash');
const parse = require('csv-parse/lib/sync')
const fs = require('fs')

const getCsv = (path) => {
    const csvRaw = fs.readFileSync(path);
    const csv = parse(csvRaw, {
        columns: true,
        bom: true
    });
    return csv;
}

const fareTableCsv = getCsv('distances.csv');

const routes = new Map();

const stops = new Map();
const routeOrigins = new Map();

const interchangeStations = ['Central', 'Redfern', 'Wynyard', 'Kings Cross', 'Wolli Creek', 'Sydenham', 'Glenfield', 'Strathfield', 'Lidcombe', 'Flemington', 'Clyde', 'Epping', 'Chatswood', 'Hornsby', 'Berowra', 'Liverpool', 'Blacktown', 'Sutherland'];
const cityStations = ['Town Hall','Wynyard','Circular Quay','Museum','St James','Martin Place','Central','Kings Cross'];

const stopArray = _.uniq(
    _.concat(
        fareTableCsv.map(z => z['Reference Station']),
        fareTableCsv.map(z => z['Station']),
        interchangeStations,
        cityStations
    )
);

for(const station of stopArray){
    if(!stops.has(station)){
        stops.set(station, graph.addVertex(station));
    }
}

fareTableCsv.forEach((distance) => {
    const origin = distance['Reference Station'];
    const destination = distance['Station'];
    const route = distance['Route'];
    const dist = Number(distance['Distance']);

    if(!routes.has(route)){
        routes.set(route, new Map());
    }

    routes.get(route).set(destination, dist);

    routeOrigins.set(route, origin);
});

routes.forEach((route, routeName) => {
    const stopDistances = [...route.entries()];
    const origin = routeOrigins.get(routeName);
    stopDistances.push([origin, 0]);
    stopDistances.sort((a, b) => a[1] - b[1]);

    const interchangeDistances = new Map();
    for(const [station, distance] of stopDistances){
        if(interchangeStations.includes(station)){
            interchangeDistances.set(station, distance);
        }
    }

    let lastStation;
    let lastDistance;
    for(const [station, distance] of stopDistances){
        if(lastStation && lastStation !== station){
            graph.addEdgePair(stops.get(station), stops.get(lastStation), Math.abs(distance - lastDistance));
        }
        lastStation = station;
        lastDistance = distance;
    }
})

// distance between any two city stations is 3.21km 
for(const o of cityStations){
    for(const d of cityStations){
        if(o === d){continue;}
        graph.addEdgePair(stops.get(o), stops.get(d), 3.21);
    }
}

const calculateFareDistance = (origin, destination) => {
    const dijkstra = new jKstra.algos.Dijkstra(graph);
    let path = dijkstra.shortestPath(stops.get(origin), stops.get(destination), {
        edgeCost: (e) => e.data
    });

    // Exception: The distance of Macarthur for Fare purposes will be the same as
    // Campbelltown. The Fare between Campbelltown and Macarthur will be that
    // applicable for 1.86km
    if(
        (origin === 'Macarthur' && destination === 'Campbelltown') ||
        (origin === 'Campbelltown' && destination === 'Macarthur')
    ){
        path = [{
            from: {data: origin},
            to: {data: destination},
            data: 1.86
        }]
    }

    const segments = path.map(({from, to, data}) => {
        return {
            from: from.data,
            to: to.data,
            distance: Number(data.toFixed(2))
        }
    });

    const distance = Number(segments.reduce((t, s) => t + s.distance, 0).toFixed(2));

    return {
        segments,
        distance
    }
}

const fareDistanceBands = [10, 20, 35, 65, Infinity];
const fareDistanceOpalAdultPrice = [3.61, 4.48, 5.15, 6.89, 8.86];
const accessFeeStations = ['International Terminal', 'Domestic Terminal'];

const calculateFare = (origin, destination, options = {}) => {
    const fareDistance = calculateFareDistance(origin, destination);
    
    const fareType = options.fareType || 'adult';
    
    let baseFareCap = Infinity;
    let baseFareDiscountFactor = 1;
    if(fareType === 'child'){
        baseFareDiscountFactor = 0.5; // child opal half price fare
    }else if(fareType === 'concession'){
        baseFareDiscountFactor = 0.5; // concession opal half price fare
    }else if(fareType === 'school'){
        baseFareDiscountFactor = 0; // school opal no fare
    }else if(fareType === 'employee'){
        baseFareDiscountFactor = 0; // employee opal no fare
    }else if(fareType === 'free'){
        baseFareDiscountFactor = 0; // free opal no fare
    }else if(fareType === 'senior'){
        baseFareDiscountFactor = 0.5; // gold opal half price fares
        baseFareCap = 2.50; // gold opal daily cap $2.50
    }

    const offPeak = !!options.offPeak;
    if(offPeak){
        // travel is 30% off during off peak
        baseFareDiscountFactor *= 0.7;
    }

    let baseFare;
    for(const i in fareDistanceBands){
        if(fareDistance.distance <= fareDistanceBands[i]){
            baseFare = fareDistanceOpalAdultPrice[i];
            break;
        }
    }

    // https://transportnsw.info/travel-info/using-public-transport/getting-to-airport
    let accessFee;
    let accessFeeOrigin;
    let accessFeeDestination;
    if(accessFeeStations.includes(origin)){
        accessFeeOrigin = origin; 
        accessFeeDestination = destination;
    }else if(accessFeeStations.includes(destination)){
        accessFeeOrigin = destination; 
        accessFeeDestination = origin;
    }

    if(accessFeeStations.includes(accessFeeDestination)){
        // began and end at a airport station
        accessFee = 2.20;
    }else if(accessFeeDestination === 'Mascot'){
        // airport to mascot
        accessFee = 6.57;
    }else if(accessFeeDestination === 'Green Square'){
        // airport to green square
        accessFee = 8.97;
    }else if(accessFeeDestination){
        if(fareType === 'concession'){
            accessFee = 13.31;
        }else if(fareType === 'senior'){
            accessFee = 13.31;
        }else if(fareType === 'child'){
            accessFee = 13.18;
        }else if(fareType === 'school'){
            accessFee = Infinity;
        }else if(baseFareDiscountFactor === 0){
            accessFee = 0;
        }else{
            accessFee = 14.87;
        }
    }

    const fare = Number(
        (
            Math.min(baseFareCap, baseFare*baseFareDiscountFactor) + 
            + accessFee
        ).toFixed(2)
    );

    return {
        fareDistance,
        baseFare,
        baseFareCap,
        baseFareDiscountFactor,
        accessFee,

        fare,

        options
    }
}

module.exports = calculateFare;