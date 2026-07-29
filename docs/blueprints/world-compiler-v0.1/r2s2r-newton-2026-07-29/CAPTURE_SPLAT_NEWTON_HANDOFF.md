# Capture Splat To Newton Handoff

Capture Splat does not install, configure, or run Newton. It produces simulator-independent
evidence that World Studio may compile into a Newton job.

## Capture Splat May Provide

- source RGB, continuous video, depth, confidence, masks, poses, intrinsics, gravity, and
  timestamps;
- metric points and ARKit/RoomPlan geometry proposals;
- Gaussian appearance;
- floor, wall, opening, object, and unknown-region proposals;
- coordinate-frame and transform evidence;
- direct measurements and synchronized calibration trials;
- uncertainty, quality reports, source hashes, and capture decisions.

## Newton-Ready Handoff Fields

A future additive handoff may reference:

- canonical units and gravity;
- frame graph and handedness;
- visual Gaussian or mesh;
- metric points;
- collision candidate type;
- finite vertex/index counts and triangle winding;
- primitive, heightfield, convex decomposition, SDF, or simplification provenance;
- floor/wall/opening coverage and unknown regions;
- object-local visual and collision frames;
- measurement/calibration evidence and apparatus;
- approved and prohibited downstream uses;
- checksums for every referenced artifact.

These fields are design proposals until schemas, migrations, fixtures, and round-trip tests
exist.

## Non-Authority Rule

Capture Splat may not infer or promote:

- mass, center of mass, inertia;
- friction, restitution, rolling resistance;
- stiffness or damping;
- force or torque;
- collision, navigation, or physics authority.

World Studio must validate import, effective collision geometry, and behavior in the
selected Newton profile. A finite mesh or successful Newton load remains `hold` without
those gates.
