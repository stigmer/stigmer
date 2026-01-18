# Upstream Zigflow Tracking

**Integration Date**: 2026-01-08
**Upstream Repository**: https://github.com/mrsimonemms/zigflow
**Upstream Commit**: b15acaf4cde70dbc073ec38e4f29f011e0042780
**Upstream License**: Apache 2.0

## Integration Strategy

We've integrated Zigflow into the Stigmer monorepo (not a GitHub fork) to:
- Maintain full control over customizations
- Integrate tightly with Stigmer APIs
- Use existing CI/CD infrastructure
- Align versioning with Stigmer releases

## Changes from Upstream

1. **Module Path**: Changed from `github.com/mrsimonemms/zigflow` to `github.com/leftbin/stigmer-cloud/backend/services/workflow-runner`
2. **Directory Structure**: Moved to `backend/services/workflow-runner/` in Stigmer monorepo
3. **Entry Point**: Renamed `cmd/zigflow` to `cmd/worker` for clarity
4. **Deployment**: Added Planton Service Hub integration
5. **Documentation**: Added Stigmer-specific documentation

## Future Customizations (Planned)

- **Phase 2**: Add Claim Check pattern for large payloads (S3/MinIO storage)
- **Phase 3**: Add AI task primitives (agent, vectordb, prompt resolution)
- **Phase 4**: Integration with Stigmer Compiler for DSL translation

## Upstream Sync Strategy

We don't plan to sync with upstream regularly because:
- Zigflow is small (~5K LOC) and mature
- CNCF Serverless Workflow spec is stable
- Our customizations will diverge significantly

If critical bug fixes appear upstream, we'll manually cherry-pick commits.

## Acknowledgments

Thank you to [@mrsimonemms](https://github.com/mrsimonemms) for creating Zigflow!

The Zigflow project provides a solid foundation for workflow orchestration on Temporal,
saving the Stigmer team an estimated 1,200+ engineering hours compared to building
a custom CNCF interpreter from scratch.

