# MVP Scope

## Product

The app is for personal task management and micro-teams of 1-5 people. It is not a CRM or corporate task tracker.

The MVP goal is to make the user's day clear:

- plan the day
- manage personal tasks
- handle basic shared tasks through simple links between users
- capture ideas and convert them into tasks

## Required Screens

- Day: today's tasks and timeline
- All tasks
- Links: shared tasks
- Ideas
- Create/edit task

The first screen after sign-in is Day.

## Task Model

Required fields:

- title
- optional short description
- date
- optional time
- optional duration
- optional assignee
- optional linked user
- status: active or completed
- priority flags: focus and important
- comments

Out of MVP:

- recurring tasks
- files
- voice comments
- complex roles
- complex permissions
- reports and analytics

## Ideas

Ideas are a separate list. An idea can be converted into a task.

## Filters And Search

MVP filters:

- date
- personal/shared
- importance

Search is by task title. Sorting is automatic by priority, date, and time.

## Data

The production product needs:

- phone auth with confirmation code
- backend and API from scratch
- basic offline support
- synchronization
- basic push notifications for new tasks and deadline reminders

Current local prototype uses AsyncStorage as the first offline-first layer.
