# Ferry Search — Backend Requirements

## 1. Feature Goal
Allow customers to search for available ferry trips between two ports for a specific date and passenger count. Supports both **One-Way** and **Round-Trip** journeys.

---

## 2. Journey Types
- **One-Way:** Customer travels from departure port to destination port only.
- **Round-Trip:** Customer travels out and later returns back on the reverse route. Requires a **Return Date**.

---

## 3. Where "From" and "To" Ports Come From (Operator Routes)

The ports available in the search dropdowns are dynamic and come directly from the backend:

1. **Created by Operators:**
   - Ferry operators create and manage routes in their dashboard (e.g. *Malé Port* to *Maafushi Port*). Detailed requirements: [operator-route-management-backend-requirements.md](file:///c:/Users/Khaled/Khaled%20Dask/Backend/nestJs/docs/operator-route-management-backend-requirements.md).
   - Only routes that are actively published by operators are available for customer booking.
2. **Backend Port & Route Options Endpoint:**
   - `GET /api/v1/routes/ports`
   - Returns all active departure ports ("From") that have at least one active route created by an operator.
3. **Connected Port Filtering:**
   - When a customer selects a departure port ("From"), the frontend only shows destination ports ("To") that are actually connected by an active operator route.
   - Example: If an operator has created a route from *Malé* to *Maafushi*, selecting *Malé* will show *Maafushi* in the "To" dropdown.

---

## 4. Required Inputs

| Input | Description | Required? |
| :--- | :--- | :--- |
| **Trip Type** | `One-Way` or `Round-Trip` | Yes |
| **From (Departure Port)** | Port where the trip starts (selected from active operator routes) | Yes |
| **To (Destination Port)** | Port where the trip ends (selected from connected operator routes) | Yes |
| **Departure Date** | Date of travel (`YYYY-MM-DD`) | Yes (Today or future) |
| **Return Date** | Date of return travel (`YYYY-MM-DD`) | Only for `Round-Trip` |
| **Passengers** | Passenger breakdown: | Yes |
| ↳ **Adults** | Number of adult passengers (age 12+) | Minimum: 1 |
| ↳ **Children** | Number of child passengers (age 2–11) | Optional (Default: 0) |
| **limit** | Number of trips to return per page | Optional (Default: 10) |
| **cursor** | ID of the last trip from previous page for cursor pagination | Optional |

> [!NOTE]
> **Total Passengers:** `Adults + Children`. The backend checks seat availability against this total count.

---

## 5. Simple Validation Rules

1. **Ports & Routes:**
   - Departure and destination ports must exist and be active.
   - Departure and destination ports cannot be the same.
   - The route between departure and destination must be an active route created by an operator.
2. **Dates:**
   - Departure date cannot be in the past.
   - For **Round-Trip**, return date is required and must be on or after the departure date.
   - For **One-Way**, return date is not required.
3. **Passengers:**
   - Must have at least 1 adult passenger.
   - Children count cannot be negative.
   - Total passengers (`Adults + Children`) cannot exceed the maximum allowed booking limit (e.g. 10 passengers).
4. **Errors:**
   - If any rule fails, return a clear error message (e.g., *"No active operator route exists between selected ports"* or *"Return date must be on or after departure date"*).

---

## 6. How the Backend Finds Trips

When a search request comes in, the backend follows these simple steps:

1. **Find Matching Trips:** Looks for active scheduled ferry trips on routes created by operators between the selected ports on the requested departure date.
2. **Check Available Seats:** Only shows trips that have enough open seats for all passengers (`Adults + Children`).
3. **Handle Round-Trip:**
   - **Outbound Trips:** Trips from `From` port to `To` port on the Departure Date.
   - **Return Trips:** Trips from `To` port back to `From` port on the Return Date (empty list for One-Way).
4. **Calculate Total Price:** Calculates price for each trip:
   - `Total Price = (Adults × Adult Fare) + (Children × Child Fare)`
5. **Sort Results:** Orders trips by departure time (earliest trips first).

---

## 7. What the Backend Returns

The response contains:
- **Cursor Pagination:** `pagination` object (`nextCursor`, `hasNextPage`, `limit`) to easily fetch the next set of trips.
- **Outbound Trips:** List of matching trips for the departure date.
- **Return Trips:** List of matching trips for the return date (empty list for One-Way).

For every matching trip, the backend returns:
- **Trip Info:** Trip ID, ferry operator name, and vessel name.
- **Timing:** Departure time, arrival time, and total trip duration.
- **Ports:** Departure port name and destination port name.
- **Availability:** Number of seats left.
- **Pricing:** Price per adult, price per child, and total estimated price for the group.

---

## 8. Simple API Example

### 1. Pre-Search: Get Available Routes & Ports
```http
GET /api/v1/routes/ports
```

**Response (`200 OK`)**
```json
[
  {
    "portId": "port-male",
    "portName": "Malé (Villingili Terminal)",
    "destinations": [
      {
        "portId": "port-maafushi",
        "portName": "Maafushi Island Port"
      }
    ]
  }
]
```

---

### 2. Search Trips (Round-Trip with Pagination)
```http
GET /api/v1/trips/search?tripType=round-trip&from=port-male&to=port-maafushi&departureDate=2026-10-20&returnDate=2026-10-25&adults=2&children=1&limit=10
```

**Response (`200 OK`)**
```json
{
  "pagination": {
    "nextCursor": "TRIP-101",
    "hasNextPage": true,
    "limit": 10
  },
  "outboundTrips": [
    {
      "tripId": "TRIP-101",
      "operator": "Island Express",
      "vessel": "Ocean Speed 1",
      "departureTime": "08:30 AM",
      "arrivalTime": "09:15 AM",
      "duration": "45m",
      "availableSeats": 24,
      "pricePerAdult": 25,
      "pricePerChild": 15,
      "totalPrice": 65
    }
  ],
  "returnTrips": [
    {
      "tripId": "TRIP-201",
      "operator": "Island Express",
      "vessel": "Ocean Speed 2",
      "departureTime": "02:00 PM",
      "arrivalTime": "02:45 PM",
      "duration": "45m",
      "availableSeats": 18,
      "pricePerAdult": 25,
      "pricePerChild": 15,
      "totalPrice": 65
    }
  ]
}
```

> **For One-Way Searches:** `returnTrips` is an empty list `[]`.

---

## 9. When No Trips Are Found
If no trips match the search criteria, the backend returns a successful `200 OK` response with empty trip lists and a friendly message:
```json
{
  "message": "No ferry trips found for the selected route and date.",
  "pagination": {
    "nextCursor": null,
    "hasNextPage": false,
    "limit": 10
  },
  "outboundTrips": [],
  "returnTrips": []
}
```
