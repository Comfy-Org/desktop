# The Plan

## History & Current State

This system has become too unstable and you have proven repeatedly that it is too complex for you to work on or achieve anything with, and it's just running in circles trying to fix problems that you create.

## New Plan

The plan is now to create a new, modular and efficient implementation, and leaving the existing implementation intact.

I need you to DESIGN AN ARCHITECTURE for the system that is attempting to be implemented on this branch. The point is to create a set of interfaces that will describe how this architecture should be created. We should specify every object we plan to create. Document (inline JSDoc) how the interfaces will interact with each other's methods.

## General style and best practices

We must follow modern coding style and best practices.

## Separation of concerns

We must break down tasks into manageable portions of code. No giant files, no giant classes. Everything that can be broken down into a logical unit should be. If something can conceptually be broken down into an interface / object, that could be added to a parent interface or object, then it SHOULD BE. This need not happen for non-complex concepts. For example, you would not create an object with a single property. That would be pointless and redundant.

We are:

- Parsing the output of the uv process
- Storing the state of the uv command as a whole
- Storing the state of the total packages when running an install.
- Storing the state of each individual download that the uv command is running.

We need interfaces for every logical component of this installation.
