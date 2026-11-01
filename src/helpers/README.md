# Helper Utilities Documentation

This directory contains reusable utility functions and helpers that promote code reusability and maintainability across the Task Titans application.

## 📁 File Structure

```
src/helpers/
├── README.md                 # This documentation file
├── serviceHelpers.ts         # Common CRUD operations and database helpers
├── paginationHelper.ts       # Pagination utilities
├── sendResponse.ts           # Standardized API response helper
└── (future utilities...)
```

## 🔧 Available Utilities

### 1. Service Helpers (`serviceHelpers.ts`)

**Purpose**: Centralize common database operations to reduce code duplication across services.

#### Available Functions:

##### `findByIdOrThrow<T>(model, id, entityName?)`
- **Description**: Finds a document by ID with automatic error handling
- **Parameters**:
  - `model`: Mongoose model
  - `id`: Document ID to find
  - `entityName`: Optional name for error messages (default: "Resource")
- **Returns**: Found document
- **Throws**: `ApiError` with 404 status if not found

**Example Usage**:
```typescript
import { findByIdOrThrow } from '../../../helpers/serviceHelpers';

const getUser = async (id: string) => {
  return await findByIdOrThrow(User, id, 'User');
};
```

##### `updateByIdOrThrow<T>(model, id, updateData, entityName?)`
- **Description**: Updates a document by ID with validation and error handling
- **Parameters**:
  - `model`: Mongoose model
  - `id`: Document ID to update
  - `updateData`: Partial data to update
  - `entityName`: Optional name for error messages
- **Returns**: Updated document
- **Throws**: `ApiError` with 404 status if not found

**Example Usage**:
```typescript
import { updateByIdOrThrow } from '../../../helpers/serviceHelpers';

const updateTask = async (id: string, payload: Partial<ITask>) => {
  return await updateByIdOrThrow(TaskModel, id, payload, 'Task');
};
```

##### `deleteByIdOrThrow<T>(model, id, entityName?)`
- **Description**: Hard deletes a document by ID with error handling
- **Returns**: Deleted document
- **Throws**: `ApiError` with 404 status if not found

##### `softDeleteByIdOrThrow<T>(model, id, entityName?)`
- **Description**: Soft deletes a document (sets `isDeleted: true`)
- **Returns**: Updated document with `isDeleted: true`
- **Throws**: `ApiError` with 404 status if not found

##### `existsById<T>(model, id)`
- **Description**: Checks if a document exists by ID
- **Returns**: `boolean`

##### `getCount<T>(model, filter?)`
- **Description**: Gets document count with optional filter
- **Parameters**:
  - `model`: Mongoose model
  - `filter`: Optional filter object
- **Returns**: `number`

##### `withTransaction(fn)`
- **Description**: Runs a set of operations inside a MongoDB transaction
- **Parameters**:
  - `fn`: Async callback that receives the `session` and returns a result
- **Returns**: Result of the callback after commit
- **Throws**: Propagates any error and automatically aborts the transaction

**Example Usage**:
```typescript
import { withTransaction } from '../../../helpers/serviceHelpers';
import { TaskModel } from '../../app/modules/task/task.model';
import { BidModel } from '../../app/modules/bid/bid.model';

const acceptBid = async (taskId: string, bidId: string) => {
  return await withTransaction(async (session) => {
    await TaskModel.findByIdAndUpdate(
      taskId,
      { $set: { assignedTo: new Types.ObjectId('...') } },
      { session }
    );

    await BidModel.updateMany(
      { taskId, _id: { $ne: bidId } },
      { $set: { status: 'rejected' } },
      { session }
    );

    return { ok: true };
  });
};
```

##### `ensureStatusOrThrow(currentStatus, expected, options?)`
- **Description**: Asserts a status value equals one of the expected values
- **Parameters**:
  - `currentStatus`: Current status value (string/number)
  - `expected`: A single expected status or an array of allowed statuses
  - `options`: `{ entityName?, message?, code? }` to customize errors
- **Throws**: `ApiError` with given or default status code

**Example Usage**:
```typescript
import { ensureStatusOrThrow } from '../../../helpers/serviceHelpers';
import { TaskStatus } from '../../app/modules/task/task.interface';

ensureStatusOrThrow(task.status, TaskStatus.UNDER_REVIEW, {
  entityName: 'Task',
  message: 'Task must be under review to complete',
});
```

##### `ensureOwnershipOrThrow(entity, ownerKey, userId, options?)`
- **Description**: Asserts the acting user owns the entity by comparing `ownerKey`
- **Parameters**:
  - `entity`: The document to check
  - `ownerKey`: Key that holds the owner id (e.g., `userId`)
  - `userId`: Acting user id (string/ObjectId)
  - `options`: `{ message?, code? }` to customize errors
- **Throws**: `ApiError` with `403` by default

**Example Usage**:
```typescript
import { ensureOwnershipOrThrow } from '../../../helpers/serviceHelpers';

ensureOwnershipOrThrow(task, 'userId', clientId, {
  message: 'Only task owner can complete the task',
});
```

### 2. Pagination Helper (`paginationHelper.ts`)

**Purpose**: Standardize pagination logic across the application.

#### `calculatePagination(options)`
- **Description**: Calculates pagination parameters from query options
- **Parameters**: Options object with page, limit, sortBy, sortOrder
- **Returns**: Calculated pagination values (page, limit, skip, sortBy, sortOrder)

**Example Usage**:
```typescript
import { calculatePagination } from '../../../helpers/paginationHelper';

const getAllTasks = async (query: ITaskQuery) => {
  const paginationOptions = calculatePagination(query);
  // Use paginationOptions for database query
};
```

### 3. Response Helper (`sendResponse.ts`)

**Purpose**: Standardize API response format across all endpoints.

#### `sendResponse<T>(res, data)`
- **Description**: Sends standardized API response
- **Parameters**:
  - `res`: Express response object
  - `data`: Response data object with success, statusCode, message, etc.

**Example Usage**:
```typescript
import sendResponse from '../../../helpers/sendResponse';

const createTask = async (req: Request, res: Response) => {
  const result = await TaskService.createTask(req.body);
  
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Task created successfully',
    data: result,
  });
};
```

## 🏗️ Builder Patterns

### AnalyticsHelper (`src/helpers/analytics/analytics.helper.ts`)

**Purpose**: Dashboard analytics, growth metrics (single $facet optimization), time trends, and performer rankings.

#### Key Methods:

##### `calculateGrowth(options)`
- **Description**: Calculates growth statistics for any model using a single-roundtrip `$facet` pipeline.
- **Parameters**: Options with filter, period, sumField, groupBy
- **Returns**: Statistics object with growth data

**Example Usage**:
```typescript
import { AnalyticsHelper } from '../../helpers/analytics';

const getUserStats = async () => {
  const analytics = new AnalyticsHelper(User);
  
  const allUsers = await analytics.calculateGrowth({ period: 'month' });
  const drivers = await analytics.calculateGrowth({
    filter: { role: USER_ROLES.DRIVER },
    period: 'month',
  });
  
  return { allUsers, drivers };
};
```

### AggregationBuilder (`src/app/builder/AggregationBuilder.ts`)

**Purpose**: Pure fluent pipeline builder for MongoDB aggregations (`match`, `group`, `project`, `sort`, `limit`, `skip`, `lookup`, `unwind`, `addFields`, `facet`, `count`).

### QueryBuilder (`src/app/builder/QueryBuilder.ts`)

**Purpose**: Build complex Mongoose queries with method chaining.

**Example Usage**:
```typescript
import QueryBuilder from '../../builder/QueryBuilder';

const getAllTasks = async (query: ITaskQuery) => {
  const taskQuery = new QueryBuilder(TaskModel.find(), query)
    .search(['title', 'description'])
    .filter()
    .sort()
    .paginate()
    .fields();
    
  const tasks = await taskQuery.modelQuery;
  return tasks;
};
```

## 🎯 Best Practices

### 1. **Import Patterns**
```typescript
// ✅ Good: Import specific functions
import { findByIdOrThrow, updateByIdOrThrow } from '../../../helpers/serviceHelpers';

// ❌ Avoid: Importing entire modules when not needed
import * as ServiceHelpers from '../../../helpers/serviceHelpers';
```

### 2. **Error Handling**
```typescript
// ✅ Good: Use helper functions with built-in error handling
const user = await findByIdOrThrow(User, id, 'User');

// ❌ Avoid: Repeating error handling logic
const user = await User.findById(id);
if (!user) {
  throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
}
```

### 3. **Consistent Entity Names**
```typescript
// ✅ Good: Use descriptive entity names
await updateByIdOrThrow(TaskModel, id, payload, 'Task');
await findByIdOrThrow(User, id, 'User');

// ❌ Avoid: Generic or unclear names
await updateByIdOrThrow(TaskModel, id, payload, 'Resource');
```

### 4. **Growth Statistics**
```typescript
// ✅ Good: Use AggregationBuilder for statistics
const builder = new AggregationBuilder(User);
const stats = await builder.calculateGrowth({ period: 'month' });

// ❌ Avoid: Duplicating growth calculation logic
const calculateMonthlyGrowth = async () => {
  // 40+ lines of duplicate code...
};
```

## 🚀 Migration Guide

### Migrating from Duplicate CRUD Operations

**Before**:
```typescript
const updateCategory = async (id: string, payload: Partial<ICategory>) => {
  const result = await Category.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Category not found');
  }
  return result;
};
```

**After**:
```typescript
import { updateByIdOrThrow } from '../../../helpers/serviceHelpers';

const updateCategory = async (id: string, payload: Partial<ICategory>) => {
  return await updateByIdOrThrow(Category, id, payload, 'Category');
};
```

### Migrating from Duplicate Growth Calculations

**Before**:
```typescript
const calculateMonthlyGrowth = async (filter = {}) => {
  // 40+ lines of duplicate code for date calculations and growth logic
};

const getUserStats = async () => {
  const allUserStats = await calculateMonthlyGrowth();
  const taskerStats = await calculateMonthlyGrowth({ role: USER_ROLES.TASKER });
  // ...
};
```

**After**:
```typescript
import AggregationBuilder from '../../builder/AggregationBuilder';

const getUserStats = async () => {
  const builder = new AggregationBuilder(User);
  
  const allUsers = await builder.calculateGrowth({ period: 'month' });
  const taskers = await builder.calculateGrowth({
    filter: { role: USER_ROLES.TASKER },
    period: 'month',
  });
  
  return { allUsers, taskers };
};
```

## 📈 Benefits

1. **Reduced Code Duplication**: ~600 lines of duplicate code eliminated
2. **Improved Maintainability**: Changes in one place affect all usages
3. **Better Error Handling**: Consistent error messages and status codes
4. **Enhanced Readability**: Clear, descriptive function names
5. **Type Safety**: Full TypeScript support with generics
6. **Easier Testing**: Centralized logic is easier to unit test

## 🔄 Future Enhancements

1. **Validation Helpers**: Common validation schemas and utilities
2. **Cache Helpers**: Redis caching utilities
3. **File Upload Helpers**: Standardized file handling
4. **Email Helpers**: Email template and sending utilities
5. **Logging Helpers**: Structured logging utilities

---

**Note**: Always update this documentation when adding new helper functions or modifying existing ones.