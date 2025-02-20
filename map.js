// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiZGhwMDAzIiwiYSI6ImNtN2R2dGE4NzAyZWIybW44Z3ZtOXJkeGIifQ.MyCs_NL6ZXpCiB5f9SfelA';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027], 
    zoom: 12, 
    minZoom: 5,
    maxZoom: 18
});

// Store global variables
let timeFilter = -1; // Default: no filtering
let stations = [];
let filteredStations = [];
let trips = []; // Store all trips globally
let filteredTrips = [];
let filteredArrivals = new Map();
let filteredDepartures = new Map();

// Wait for the map to load before adding data
map.on('load', () => {
    console.log("Map loaded. Adding bike lane sources...");

    // Add Boston bike lanes data source
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
    });

    // Add Cambridge bike lanes data source
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });

    // Define bike lane style
    const bikeLaneStyle = {
        'line-color': '#32D400',
        'line-width': 3,
        'line-opacity': 0.6
    };

    // Add bike lane layers
    map.addLayer({ id: 'boston-bike-lanes', type: 'line', source: 'boston_route', paint: bikeLaneStyle });
    map.addLayer({ id: 'cambridge-bike-lanes', type: 'line', source: 'cambridge_route', paint: bikeLaneStyle });

    console.log("Bike lane layers added.");

    // Load the Bluebikes station data
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    d3.json(jsonurl).then(jsonData => {
        console.log('Loaded JSON Data:', jsonData);
    
        // Store station data globally
        stations = jsonData.data.stations;
        filteredStations = [...stations]; // Initialize filteredStations with all stations

        console.log('Stations Array:', stations);
    
        // Select the map container and append an SVG layer
        const svg = d3.select('#map').append('svg')
            .style('position', 'absolute')
            .style('top', '0')
            .style('left', '0')
            .style('width', '100%')
            .style('height', '100%')
            .style('pointer-events', 'none')
            .style('z-index', '1');

        // Load traffic data AFTER stations are available
        const trafficUrl = "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";
        d3.csv(trafficUrl).then(tripData => {
            console.log("Loaded Bike Traffic Data:", tripData);

            // Store trips globally
            trips = tripData.map(trip => ({
                ...trip,
                started_at: new Date(trip.started_at),
                ended_at: new Date(trip.ended_at)
            }));

            // Process station traffic and update markers
            updateStationTraffic();
            updateMarkers(stations, svg); 

            // Now, enable the slider functionality
            timeSlider.addEventListener('input', updateTimeDisplay);
            updateTimeDisplay(); 

        }).catch(error => console.error("Error loading traffic data:", error));

    }).catch(error => console.error("Error loading station data:", error));
});

// Function to convert lat/lon to pixel coordinates
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

// Function to update station traffic
function updateStationTraffic() {
    if (trips.length === 0) return; // Ensure trips is loaded

    // If no filtering, use full trip dataset
    filteredTrips = timeFilter === -1
        ? trips
        : trips.filter(trip => {
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);
            return (
                Math.abs(startedMinutes - timeFilter) <= 60 ||
                Math.abs(endedMinutes - timeFilter) <= 60
            );
        });

    console.log("Filtered Trips:", filteredTrips);

    // Calculate arrivals and departures
    filteredArrivals = d3.rollup(filteredTrips, v => v.length, d => d.end_station_id);
    filteredDepartures = d3.rollup(filteredTrips, v => v.length, d => d.start_station_id);

    // Update station data with filtered traffic counts
    filteredStations = stations.map(station => ({
        ...station,
        arrivals: filteredArrivals.get(station.short_name) ?? 0,
        departures: filteredDepartures.get(station.short_name) ?? 0,
        totalTraffic: (filteredArrivals.get(station.short_name) ?? 0) +
                      (filteredDepartures.get(station.short_name) ?? 0),
    }));

    console.log("Filtered Stations Updated:", filteredStations);
}

// Function to update markers with traffic data and color them based on flow
function updateMarkers(stations, svg) {
    console.log("Updating markers with traffic data...");

    // Define a scale for station circle sizes
    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(stations, d => d.totalTraffic)])
        .range(timeFilter === -1 ? [0, 25] : [3, 50]);

    // Define a quantize scale for traffic flow visualization
    const stationFlow = d3.scaleQuantize()
        .domain([0, 1])  // Departure ratio: 0 (arrivals only) → 1 (departures only)
        .range(["darkorange", "gray", "steelblue"]); // Arrivals, Balanced, Departures

    // Bind data to circles
    const stationMarkers = svg.selectAll("circle")
        .data(stations, d => d.short_name)
        .join("circle")
        .attr("stroke", "white")
        .attr("stroke-width", 1)
        .attr("opacity", 0.6)
        .style("pointer-events", "auto")
        .attr("fill", d => {
            if (d.totalTraffic === 0) return "gray"; // No traffic, neutral color
            return stationFlow(d.departures / d.totalTraffic);
        })
        .each(function(d) {
            d3.select(this).selectAll("title").remove();
            d3.select(this).append("title")
                .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });

    function updatePositions() {
        stationMarkers
            .attr("r", d => radiusScale(d.totalTraffic))
            .attr("cx", d => getCoords(d).cx)
            .attr("cy", d => getCoords(d).cy);
    }

    updatePositions();
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
}


// Time Slider Reactivity
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
    } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
    }
    filterTripsByTime();
}

function filterTripsByTime() {
    updateStationTraffic();
    updateMarkers(filteredStations, d3.select('#map').select('svg'));
}
