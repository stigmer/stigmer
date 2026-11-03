"""The Stigmer quick start: connect to the Stigmer running on this machine,
set up a small agent, ask it one thing and print its answer.

Start Stigmer first with `stigmer up` (given a model key), then:
python quickstart.py
"""

import sys

from stigmer import AgentInput, ResourceRef, SessionSpecInput, StigmerClient, StigmerError

try:
    # `stigmer up` serves on localhost:7234 and needs no key on your machine.
    with StigmerClient(base_url="localhost:7234", insecure=True) as client:
        # apply creates the agent, or updates it when you run this again.
        agent = client.agents.apply(
            AgentInput(
                name="greeter",
                org="stigmer",
                instructions="You greet people in one short, friendly sentence.",
            )
        )

        turn = client.send_and_wait(
            org="stigmer",
            session_spec=SessionSpecInput(agent_ref=ResourceRef(org="stigmer", slug=agent.metadata.slug)),
            message="Say hello to a developer trying Stigmer for the first time.",
        )
except StigmerError as err:
    sys.exit(f"stigmer: {err}")

if turn.phase != "completed":
    sys.exit(f"the turn did not complete ({turn.phase}): {turn.error}")
print(turn.answer)
