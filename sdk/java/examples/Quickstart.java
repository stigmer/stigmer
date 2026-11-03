// The Stigmer quick start: connect to the Stigmer running on this machine,
// set up a small agent, ask it one thing and print its answer.
//
// Start Stigmer first with `stigmer up` (given a model key), then run this
// file with the SDK on the classpath: java -cp <classpath> Quickstart.java

import ai.stigmer.agentic.agent.v1.Agent;
import ai.stigmer.sdk.SendAndWaitInput;
import ai.stigmer.sdk.StigmerClient;
import ai.stigmer.sdk.TurnOutcome;
import ai.stigmer.sdk.gen.AgentInput;
import ai.stigmer.sdk.gen.ResourceRef;
import ai.stigmer.sdk.gen.RunInput;
import ai.stigmer.sdk.gen.StigmerException;

public class Quickstart {
    public static void main(String[] args) {
        // `stigmer up` serves on localhost:7234 and needs no key on your machine.
        try (StigmerClient client = StigmerClient.builder().baseUrl("localhost:7234").insecure().build()) {
            // apply creates the agent, or updates it when you run this again.
            Agent agent = client.agent.apply(AgentInput.builder()
                    .name("greeter")
                    .org("stigmer")
                    .instructions("You greet people in one short, friendly sentence.")
                    .build());

            TurnOutcome turn = client.sendAndWait(SendAndWaitInput.builder()
                    .org("stigmer")
                    .sessionSpec(RunInput.SessionSpecInput.builder()
                            .agentRef(ResourceRef.of("stigmer", agent.getMetadata().getSlug()))
                            .build())
                    .message("Say hello to a developer trying Stigmer for the first time.")
                    .build());
            if (!turn.phase().equals("completed")) {
                System.err.println("the turn did not complete (" + turn.phase() + "): " + turn.error());
                System.exit(1);
            }
            System.out.println(turn.answer());
        } catch (StigmerException e) {
            System.err.println("stigmer: " + e.getMessage());
            System.exit(1);
        }
    }
}
