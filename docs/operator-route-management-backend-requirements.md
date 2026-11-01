# Operator Route Management — Backend Requirements

## 1. Feature Goal
Allow ferry operators (`Role.OPERATOR`) to create, view, edit, and deactivate ferry routes between island ports. These operator routes form the foundation for trip schedules and customer searches.

---

## 2. Who Can Use This Feature?
- **User Role:** `Role.OPERATOR` (Operator Only).
- **Tenant Scope:** Operators can only view, edit, or delete their own routes. They cannot see or modify routes created by other operators.

---

## 3. Required Inputs for Creating a Route

| Field | Type | Description | Rules & Example |
| :--- | :--- | :--- | :--- |
| `departurePortId` | String / UUID | Port where the route starts | Required. Must be an active master port. |
| `destinationPortId` | String / UUID | Port where the route ends | Required. Must be an active master port. |
| `durationMinutes` | Integer | Estimated travel time in minutes | Required. Example: `45` (45 minutes). Minimum: 5. |
| `isBorderCrossing` | Boolean | Whether international border check is required | Optional. Default: `false` (domestic travel). |
| `status` | String | Initial route state (`ACTIVE` or `INACTIVE`) | Optional. Default: `ACTIVE`. |

---

## 4. Simple Validation Rules

1. **Port Rules:**
   - Both `departurePortId` and `destinationPortId` must be valid, active ports.
   - Departure port and destination port cannot be the same.
2. **Duplicate Prevention:**
   - An operator cannot create the same route (same departure port and destination port) more than once.
3. **Duration Rules:**
   - Travel duration must be a positive number greater than 0 (e.g. minimum 5 minutes, maximum 720 minutes / 12 hours).
4. **Safety Check on Deletion:**
   - An operator cannot delete or deactivate a route if there are upcoming scheduled trips with booked passenger tickets.
5. **Errors:**
   - Return standard 400 Bad Request error messages if any validation fails (e.g., *"Departure port and destination port cannot be the same"* or *"You already have an active route for this port pair"*).

---

## 5. Endpoints & Operations

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **POST** | `/api/v1/operator/routes` | Create a new route for the logged-in operator |
| **GET** | `/api/v1/operator/routes` | List all routes created by the operator (with offset pagination: `page`, `limit`) |
| **GET** | `/api/v1/operator/routes/:id` | Get details of a single route |
| **PATCH** | `/api/v1/operator/routes/:id` | Update route duration, border crossing, or status |
| **DELETE** | `/api/v1/operator/routes/:id` | Deactivate or delete route (if no active booked trips) |

---

## 6. Simple API Examples

### 1. Create Route

**Request (`POST /api/v1/operator/routes`)**
```json
{
  "departurePortId": "port-male",
  "destinationPortId": "port-maafushi",
  "durationMinutes": 45,
  "isBorderCrossing": false,
  "status": "ACTIVE"
}
```

**Response (`201 Created`)**
```json
{
  "id": "route-001",
  "operatorId": "op-island-express",
  "departurePort": {
    "id": "port-male",
    "name": "Malé (Villingili Terminal)"
  },
  "destinationPort": {
    "id": "port-maafushi",
    "name": "Maafushi Island Port"
  },
  "durationMinutes": 45,
  "isBorderCrossing": false,
  "status": "ACTIVE",
  "createdAt": "2026-10-13T16:15:00Z"
}
```

---

### 2. List Operator Routes (Dashboard Table)

**Query Parameters:**
- `page`: Page number (Default: `1`)
- `limit`: Items per page (Default: `10`)

**Request (`GET /api/v1/operator/routes?page=1&limit=10`)**

**Response (`200 OK`)**
```json
{
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalItems": 15,
    "totalPages": 2
  },
  "routes": [
    {
      "id": "route-001",
      "departurePort": {
        "id": "port-male",
        "name": "Malé (Villingili Terminal)"
      },
      "destinationPort": {
        "id": "port-maafushi",
        "name": "Maafushi Island Port"
      },
      "durationMinutes": 45,
      "isBorderCrossing": false,
      "status": "ACTIVE",
      "activeSchedulesCount": 3
    }
  ]
}
```

---

### 3. Update Route

**Request (`PATCH /api/v1/operator/routes/route-001`)**
```json
{
  "durationMinutes": 50,
  "status": "INACTIVE"
}
```

**Response (`200 OK`)**
```json
{
  "id": "route-001",
  "durationMinutes": 50,
  "status": "INACTIVE",
  "updatedAt": "2026-10-13T16:20:00Z"
}
```

---

## 7. How This Connects to Customer Search

1. **Operator creates Route:** Operator sets up a route (e.g. *Malé* ➔ *Maafushi*).
2. **Operator schedules Trips:** Operator assigns vessels and departure times to this route.
3. **Public Search availability:** The search endpoint (`GET /api/v1/routes/ports`) reads these active routes to populate customer dropdowns, and matches available trips during search (see [quick-search-backend-requirements.md](file:///c:/Users/Khaled/Khaled%20Dask/Backend/nestJs/docs/quick-search-backend-requirements.md)).
